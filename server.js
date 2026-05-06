import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(join(__dirname, 'public')));
app.use('/vendor/spektrum', express.static(join(__dirname, 'node_modules/spektrum')));

app.listen(port, () => {
  console.log(`weather-app-spektrum listening on http://localhost:${port}`);
});
