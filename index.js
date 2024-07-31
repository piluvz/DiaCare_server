import OpenAI from 'openai';
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
const port = 3001;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(cors());
app.use(bodyParser.json());

const requiredDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

const validateResponse = (response) => {
  const jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch && jsonMatch[1]) {
    try {
      const jsonResult = JSON.parse(jsonMatch[1].trim());
      return requiredDays.every(day => jsonResult.hasOwnProperty(day));
    } catch (error) {
      console.error('Error parsing JSON:', error);
      return false;
    }
  }
  return false;
};

app.post('/api/diabetes', async (req, res) => {
  const {
    diabetesType,
    gender,
    age,
    height,
    weight,
    physicalActivity,
    selectedOption,
    chronicDiseases
  } = req.body;

  const assistantId = process.env.OPENAI_ASSISTANT_ID;

  const messageContent = `
    Я диабетик. Вот моя информация:
    Тип диабета: ${diabetesType}
    Пол: ${gender}
    Возраст: ${age}
    Рост: ${height} см
    Вес: ${weight} кг
    Уровень физической активности: ${physicalActivity}
    Осложнения: ${selectedOption}
    Хронические заболевания: ${chronicDiseases}
    Помоги мне составить рацион питания на неделю, чтобы каждый день был разнообразным и не повторялся, и выведи список необходимых продуктов.
    Учти чтобы рацион и выбранные продукты подходили мне при моем состоянии диабета.`
  ;

  let assistantOutput = '';

  try {
    const thread = await openai.beta.threads.create();

    const message = await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: messageContent
    });

    const run = openai.beta.threads.runs.stream(thread.id, {
      assistant_id: assistantId
    });

    run.on('textDelta', (textDelta, snapshot) => {
      assistantOutput += textDelta.value;
    });

    run.on('end', () => {
      if (validateResponse(assistantOutput)) {
        res.json({ assistantOutput });
      } else {
        res.status(500).json({ error: 'Invalid response from the assistant' });
      }
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while processing the request.' });
  }
});

app.post('/api/nutrition-plan', (req, res) => {
  const { assistantOutput } = req.body;
  const jsonMatch = assistantOutput.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch && jsonMatch[1]) {
    try {
      const jsonResult = JSON.parse(jsonMatch[1].trim());
      res.json(jsonResult);

    } catch (error) {
      console.error('Error parsing JSON:', error);
      res.status(500).json({ error: 'Invalid JSON format in the response' });
    }
  } else {
    res.status(500).json({ error: 'No JSON found in the response' });
  }
});

const findSimilarProduct = (title, products) => {
  const titleWords = title.split(' ').slice(0, 2).join(' ');
  return products.find(product => product.title.includes(titleWords));
};

app.post('/api/search-products', (req, res) => {
  const { productNames } = req.body;

  fs.readFile('transformed_products.json', 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading transformed_product.json:', err);
      res.status(500).json({ error: 'Error reading product file' });
      return;
    }

    try {
      const products = JSON.parse(data);
      const matchedProducts = productNames.map(name => {
        let product = products.find(p => p.title === name);
        if (!product) {
          product = findSimilarProduct(name, products);
        }
        return product;
      }).filter(Boolean);

      res.json(matchedProducts);
    } catch (error) {
      console.error('Error parsing JSON:', error);
      res.status(500).json({ error: 'Invalid JSON format in product file' });
    }
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
