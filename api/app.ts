import express from 'express';
import cors from 'cors';
import apiRoutes from './routes/index.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    name: '微生物文明馆 API',
    version: '1.0.0',
    endpoints: {
      'GET /api/microbes': '获取所有微生物列表',
      'GET /api/microbes/:id': '获取单个微生物详情',
      'GET /api/microbes/category/:category': '按分类获取微生物',
      'GET /api/microbes/:id/related': '获取相关微生物',
      'GET /api/stats': '获取统计数据',
      'GET /api/ecology/levels': '生态解谜关卡列表',
      'POST /api/ecology/puzzles': '服务端生成并洗牌生态谜题',
      'POST /api/ecology/grade': '服务端裁决玩家提交',
      'POST /api/ecology/hints': '按卡住时间返回分级扣分提示',
    },
  });
});

app.use('/api', apiRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: '接口不存在' });
});

export default app;
