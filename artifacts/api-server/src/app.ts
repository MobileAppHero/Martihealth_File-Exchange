import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Behind marti-alb: resolve the real client IP from x-forwarded-for (the
// admin IP allowlist and audit rows depend on it).
app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production the same process serves the built SPA (so the session cookie
// is same-origin). CLIENT_DIST_DIR is set by the Docker image.
const clientDistDir = process.env.CLIENT_DIST_DIR;
if (clientDistDir) {
  const indexHtml = path.resolve(clientDistDir, "index.html");
  app.use(express.static(clientDistDir));
  app.get(/^\/(?!api(\/|$)).*/, (_req, res) => {
    res.sendFile(indexHtml);
  });
}

export default app;
