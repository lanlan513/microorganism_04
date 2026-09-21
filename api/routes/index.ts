import { Router } from 'express';
import { MicrobeController } from '../src/controllers/MicrobeController.js';
import { ecologyRouter } from './ecology.js';

const router = Router();

router.use('/', ecologyRouter);
router.get('/microbes', MicrobeController.getAll);
router.get('/microbes/stats', MicrobeController.getStats);
router.get('/microbes/category/:category', MicrobeController.getByCategory);
router.get('/microbes/:id', MicrobeController.getById);
router.get('/microbes/:id/related', MicrobeController.getRelated);
router.get('/stats', MicrobeController.getStats);

export default router;
