import { XMLValidator, XMLParser } from "fast-xml-parser";

/**
 * Parse-checks for clinical data files landing in the exchange bucket.
 * Each validator returns null when the content passes, or a short
 * human-readable reason string when it should be quarantined.
 *
 * Policy (v1):
 * - .hl7           → must be a structurally sane HL7 v2 message (MSH header,
 *                    segment grammar). Not a semantic/profile validation.
 * - .ccda / .cda   → well-formed XML with a ClinicalDocument root.
 * - .xml           → well-formed XML (generic data exchange stays allowed).
 * - .json          → syntactically valid JSON; if it claims to be FHIR
 *                    (resourceType present) the claim must be coherent.
 * - .ndjson        → every line valid JSON object with a resourceType
 *                    (FHIR bulk-data convention).
 * Everything else (csv, edi, pgp, zip, …) is out of scope and never touched.
 */

export const VALIDATED_EXTENSIONS = new Set(["hl7", "ccda", "cda", "xml", "json", "ndjson"]);

const SEGMENT_RE = /^[A-Z][A-Z0-9]{2}$/;

export function validateHl7v2(text) {
  const content = text.replace(/^﻿/, "");
  if (!content.startsWith("MSH")) return "HL7 v2: message must start with an MSH segment";
  const fieldSep = content[3];
  if (!fieldSep || /[A-Za-z0-9\s]/.test(fieldSep)) {
    return "HL7 v2: MSH is missing a field separator (expected e.g. MSH|^~\\&)";
  }
  const encoding = content.slice(4, content.indexOf(fieldSep, 4));
  if (encoding.length < 1 || encoding.length > 5) {
    return "HL7 v2: MSH-2 encoding characters are malformed";
  }
  // Segments are CR-separated per spec; accept LF/CRLF from transport.
  const segments = content.split(/\r\n|\r|\n/).filter((s) => s.trim().length > 0);
  if (segments.length < 2) return "HL7 v2: message has no segments beyond MSH";
  for (const seg of segments) {
    const id = seg.slice(0, 3);
    if (!SEGMENT_RE.test(id)) return `HL7 v2: invalid segment identifier "${id.slice(0, 10)}"`;
    if (id !== "MSH" && seg[3] !== fieldSep) {
      return `HL7 v2: segment ${id} does not use the declared field separator`;
    }
  }
  return null;
}

function xmlRootName(text) {
  const parser = new XMLParser({ ignoreDeclaration: true, ignorePiTags: true });
  const doc = parser.parse(text);
  const roots = Object.keys(doc).filter((k) => !k.startsWith("?") && k !== "#comment");
  return roots[0] ?? null;
}

export function validateXml(text, { requireClinicalDocument = false } = {}) {
  const result = XMLValidator.validate(text);
  if (result !== true) {
    return `XML: not well-formed (${result.err?.msg ?? "parse error"} at line ${result.err?.line ?? "?"})`;
  }
  if (requireClinicalDocument) {
    const root = xmlRootName(text);
    if (root !== "ClinicalDocument" && !root?.endsWith(":ClinicalDocument")) {
      return `CCDA: root element must be ClinicalDocument (found "${root ?? "none"}")`;
    }
  }
  return null;
}

function checkFhirShape(value) {
  if (typeof value.resourceType !== "string" || value.resourceType.length === 0) {
    return "FHIR: resourceType must be a non-empty string";
  }
  if (value.resourceType === "Bundle") {
    if (typeof value.type !== "string") return "FHIR: Bundle is missing its required type";
    if (value.entry !== undefined && !Array.isArray(value.entry)) {
      return "FHIR: Bundle.entry must be an array";
    }
  }
  return null;
}

export function validateJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return `JSON: not parseable (${err.message.slice(0, 120)})`;
  }
  // Generic JSON data files are allowed; FHIR checks apply only when claimed.
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "resourceType" in value) {
    return checkFhirShape(value);
  }
  return null;
}

export function validateNdjson(text) {
  const lines = text.split(/\r\n|\n/);
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    seen++;
    let value;
    try {
      value = JSON.parse(line);
    } catch (err) {
      return `NDJSON: line ${i + 1} is not valid JSON (${err.message.slice(0, 80)})`;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return `NDJSON: line ${i + 1} is not a JSON object`;
    }
    const shape = checkFhirShape(value);
    if (shape) return `NDJSON: line ${i + 1} — ${shape}`;
  }
  if (seen === 0) return "NDJSON: file contains no records";
  return null;
}

/** Returns null (pass) or a quarantine reason string. */
export function validateContent(extension, text) {
  switch (extension) {
    case "hl7":
      return validateHl7v2(text);
    case "ccda":
    case "cda":
      return validateXml(text, { requireClinicalDocument: true });
    case "xml":
      return validateXml(text);
    case "json":
      return validateJson(text);
    case "ndjson":
      return validateNdjson(text);
    default:
      return null;
  }
}
