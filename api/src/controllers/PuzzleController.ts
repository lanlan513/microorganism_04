import type { Request, Response } from 'express';
import { adjudicateSubmission, getPublicLevel, listPuzzleLevels, requestHint, runLayoutBenchmark } from '../services/PuzzleService.js';

export class PuzzleController {
  static listLevels(_req: Request, res: Response) {
    res.json({ success: true, data: listPuzzleLevels() });
  }

  static layoutBenchmark(_req: Request, res: Response) {
    res.json({ success: true, data: runLayoutBenchmark() });
  }

  static getLevel(req: Request, res: Response) {
    const level = getPublicLevel(req.params.levelId);
    if (!level) {
      return res.status(404).json({ success: false, error: '关卡不存在' });
    }
    return res.json({ success: true, data: level });
  }

  static submit(req: Request, res: Response) {
    const verdict = adjudicateSubmission(req.body);
    if ('error' in verdict) {
      return res.status(verdict.statusCode).json({ success: false, error: verdict.error });
    }
    return res.json({ success: true, data: verdict });
  }

  static hint(req: Request, res: Response) {
    const hint = requestHint({
      levelId: String(req.body?.levelId ?? req.params.levelId),
      assignment: req.body?.assignment,
      elapsedSeconds: req.body?.elapsedSeconds,
      tier: req.body?.tier,
    });
    if ('error' in hint) {
      return res.status(hint.statusCode).json({ success: false, error: hint.error });
    }
    return res.json({ success: true, data: hint });
  }
}
