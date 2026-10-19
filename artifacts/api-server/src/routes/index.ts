import { Router, type IRouter } from "express";
import healthRouter from "./health";
import luStudioRouter from "./lu-studio";

const router: IRouter = Router();

router.use(healthRouter);
router.use(luStudioRouter);

export default router;

