const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// فوروارد به بله
app.all('/bale/*', async (req, res) => {
  const targetUrl = `https://tapi.bale.ai/${req.params[0]}`;
  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body,
      headers: { 'Content-Type': 'application/json' }
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

// فوروارد به ایتا
app.all('/eitaa/*', async (req, res) => {
  const targetUrl = `https://eitaayar.ir/${req.params[0]}`;
  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body,
      headers: { 'Content-Type': 'application/json' }
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Relay running on port ${PORT}`));
