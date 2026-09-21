import { Router } from 'express';
import { MicrobeController } from '../src/controllers/MicrobeController.js';
import { PuzzleController } from '../src/controllers/PuzzleController.js';

const router = Router();

router.get('/puzzles', PuzzleController.listLevels);
router.get('/puzzle-layout-benchmark', PuzzleController.layoutBenchmark);
router.get('/puzzles/:levelId', PuzzleController.getLevel);
router.post('/puzzles/submit', PuzzleController.submit);
router.post('/puzzles/:levelId/hint', PuzzleController.hint);

router.get('/microbes', MicrobeController.getAll);
router.get('/microbes/stats', MicrobeController.getStats);
router.get('/microbes/category/:category', MicrobeController.getByCategory);
router.get('/microbes/:id', MicrobeController.getById);
router.get('/microbes/:id/related', MicrobeController.getRelated);
router.get('/stats', MicrobeController.getStats);

export default router;
