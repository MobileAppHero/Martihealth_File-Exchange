import assert from "node:assert/strict";

import { validateContent } from "../validators.mjs";

const GOOD_HL7 = [
  "MSH|^~\\&|SENDER|FAC|RCVR|FAC|20261022120000||ADT^A01|MSG0001|P|2.5.1",
  "EVN|A01|20261022120000",
  "PID|1||12345^^^MRN||DOE^JANE||19800101|F",
].join("\r");

const GOOD_CCDA = `<?xml version="1.0"?><ClinicalDocument xmlns="urn:hl7-org:v3"><id root="1.2.3"/></ClinicalDocument>`;

const cases = [
  // [extension, content, shouldPass, label]
  ["hl7", GOOD_HL7, true, "well-formed ADT^A01"],
  ["hl7", GOOD_HL7.replace(/\r/g, "\n"), true, "LF-separated segments accepted"],
  ["hl7", "hello world", false, "not an HL7 message"],
  ["hl7", "MSH|^~\\&|ONLY", false, "MSH with no further segments"],
  ["hl7", GOOD_HL7 + "\rbad segment here", false, "garbage segment id"],
  ["hl7", "MSHX^~\\&|A|B\rPID|1", false, "alphanumeric field separator"],
  ["ccda", GOOD_CCDA, true, "minimal ClinicalDocument"],
  ["cda", GOOD_CCDA, true, ".cda treated as CCDA"],
  ["ccda", `<?xml version="1.0"?><Patient/>`, false, "wrong root element"],
  ["ccda", `<ClinicalDocument><unclosed>`, false, "malformed XML"],
  ["xml", `<data><row a="1"/></data>`, true, "generic well-formed XML"],
  ["xml", `<data><row></data>`, false, "mismatched tags"],
  ["json", `{"resourceType":"Patient","id":"p1"}`, true, "FHIR Patient"],
  ["json", `{"resourceType":"Bundle","type":"collection","entry":[]}`, true, "FHIR Bundle"],
  ["json", `{"resourceType":"Bundle"}`, false, "Bundle missing type"],
  ["json", `{"resourceType":""}`, false, "empty resourceType"],
  ["json", `{"members":[{"id":1}]}`, true, "generic JSON still allowed"],
  ["json", `{"broken":`, false, "truncated JSON"],
  ["ndjson", `{"resourceType":"Patient","id":"1"}\n{"resourceType":"Patient","id":"2"}\n`, true, "FHIR bulk data"],
  ["ndjson", `{"resourceType":"Patient"}\nnot json\n`, false, "bad line 2"],
  ["ndjson", `{"id":"no-resource-type"}`, false, "NDJSON record missing resourceType"],
  ["ndjson", `\n\n`, false, "empty NDJSON"],
];

let failures = 0;
for (const [ext, content, shouldPass, label] of cases) {
  const reason = validateContent(ext, content);
  const passed = reason === null;
  if (passed !== shouldPass) {
    failures++;
    console.error(`FAIL [${ext}] ${label} — expected ${shouldPass ? "pass" : "quarantine"}, got ${reason ?? "pass"}`);
  } else {
    console.log(`ok   [${ext}] ${label}${reason ? ` → "${reason}"` : ""}`);
  }
}

assert.equal(failures, 0, `${failures} validator case(s) failed`);
console.log(`\nAll ${cases.length} cases passed.`);
