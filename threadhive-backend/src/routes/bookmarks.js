import express from "express";
import authHandler from "../middleware/authHandler.js";
import {
  getBookmarks,
  getBookmarkIds,
  saveBookmark,
  unsaveBookmark,
} from "../controllers/bookmarkController.js";

const router = express.Router();

router.get("/", authHandler, getBookmarks);
// Literal paths are declared before /:threadId.
router.get("/ids", authHandler, getBookmarkIds);
router.put("/:threadId", authHandler, saveBookmark);
router.delete("/:threadId", authHandler, unsaveBookmark);

export default router;
