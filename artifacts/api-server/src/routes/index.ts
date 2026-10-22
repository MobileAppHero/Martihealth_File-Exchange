import { Router, type IRouter } from "express";
import adminRouter from "./admin";
import authRouter from "./auth";
import filesRouter from "./files";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(filesRouter);
router.use(adminRouter);

export default router;
