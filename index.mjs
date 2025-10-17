import express from 'express';
import multer from 'multer';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { MODEL_PREFERENCIAL, MODEL_FALLBACK, OPENAI_API_KEY } from './config/env.mjs';

const app = express();
const upload = multer({ dest: 'uploads/' });

function gerarHashPDF(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor ativo e funcional' });
});

// Logs endpoint
app.get('/logs', (req, res) => {
  try {
    const auditoria = JSON.parse(fs.readFileSync('./logs/auditoria.json', 'utf8'));
    const usage = JSON.parse(fs.readFileSync('./logs/usage.json', 'utf8'));
    res.json({ auditoria, usage });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao ler logs' });
  }
});

// Extract endpoint
app.post('/extract-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Arquivo PDF ausente.' });

    const filePath = req.file.path;
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    const texto = pdfData.text.split('\n').slice(0, 200).join(' ');
    const hash_pdf = gerarHashPDF(filePath);

    const modelos = [MODEL_PREFERENCIAL, MODEL_FALLBACK];
    let respostaGPT = null;
    let modelo_usado = null;

    for (const modelo of modelos) {
      try {
        const gptResponse = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: modelo,
            input: `Extraia os dados da fatura Equatorial: ${texto}`,
            text: { format: "json" }
          })
        });
        const result = await gptResponse.json();
        if (result.output) {
          respostaGPT = result.output;
          modelo_usado = modelo;
          break;
        }
      } catch (err) {
        console.error('Erro no modelo', modelo, err);
      }
    }

    if (!respostaGPT) {
      return res.status(500).json({ error: 'Falha ao processar a fatura. GPT não retornou conteúdo válido.' });
    }

    const usagePath = './logs/usage.json';
    const usageData = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    const tokensConsumidos = respostaGPT.usage?.total_tokens || 0;
    usageData.tokens_mes = (usageData.tokens_mes || 0) + tokensConsumidos;
    fs.writeFileSync(usagePath, JSON.stringify(usageData, null, 2));

    const auditoria = JSON.parse(fs.readFileSync('./logs/auditoria.json', 'utf8'));
    auditoria.push({
      timestamp: new Date().toISOString(),
      hash_pdf,
      modelo_usado,
      tokens_consumidos: tokensConsumidos
    });
    fs.writeFileSync('./logs/auditoria.json', JSON.stringify(auditoria, null, 2));

    res.json({
      hash_pdf,
      modelo_usado,
      tokens_consumidos: tokensConsumidos,
      tokens_mes: usageData.tokens_mes,
      dados_extraidos: respostaGPT.output_text || null
    });
  } catch (err) {
    console.error('Erro geral:', err);
    res.status(500).json({ error: 'Falha ao processar a fatura.' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
