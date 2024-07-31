import 'dotenv/config';
import OpenAI from 'openai';
// import fs from 'fs/promises';
import express from 'express';
import bodyParser from 'body-parser';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function readJSONFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return data.split('\n').map(line => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    }).filter(item => item !== null);
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return [];
  }
}

async function findProducts(requiredProducts, products) {
  const result = [];

  requiredProducts.forEach(requiredProduct => {
    const product = products.find(p => p.title.includes(requiredProduct));
    if (product) {
      result.push({
        Название: requiredProduct,
        Цена: product.price,
        URL: product.url
      });
    } else {
      console.warn(`Product not found: ${requiredProduct}`);
    }
  });

  return result;
}

async function main() {
  const assistantId = process.env.OPENAI_ASSISTANT_ID;

  const thread = await openai.beta.threads.create();

  const message = await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: "Я диабетик, помоги мне составить рацион питания и выведи список необходимых продуктов."
  });

  const run = openai.beta.threads.runs.stream(thread.id, {
    assistant_id: assistantId
  })
    .on('textCreated', (text) => process.stdout.write('\nassistant > '))
    .on('textDelta', (textDelta, snapshot) => process.stdout.write(textDelta.value))
    .on('toolCallCreated', (toolCall) => process.stdout.write(`\nassistant > ${toolCall.type}\n\n`))
    .on('toolCallDelta', async (toolCallDelta, snapshot) => {
      if (toolCallDelta.type === 'code_interpreter') {
        if (toolCallDelta.code_interpreter.input) {
          process.stdout.write(toolCallDelta.code_interpreter.input);
        }
        if (toolCallDelta.code_interpreter.outputs) {
          process.stdout.write("\noutput >\n");
          const outputs = toolCallDelta.code_interpreter.outputs;
          const assistantOutput = outputs.map(output => output.logs).join('\n');

          console.log('Assistant Output:', assistantOutput);

          // Парсинг вывода ассистента для получения списка продуктов
          const requiredProducts = [];
          const lines = assistantOutput.split('\n');
          let capture = false;

          lines.forEach(line => {
            if (line.startsWith('## Список всех продуктов:')) {
              capture = true;
            } else if (capture && line.trim() !== '') {
              const productName = line.replace(/^\d+\.\s*/, '').trim();
              requiredProducts.push(productName);
            }
          });

          console.log('Required Products:', requiredProducts);

          // Читаем файл products.json
          const products = await readJSONFile('transformed_products.json');
          console.log('Products from JSON:', products);

          // Ищем продукты
          const foundProducts = await findProducts(requiredProducts, products);

          // Выводим найденные продукты в консоль
          foundProducts.forEach(product => {
            console.log(`Название: ${product.Название}\nЦена: ${product.Цена}\nURL: ${product.URL}\n`);
          });

          // Записываем результаты в файл
          await fs.writeFile('found_products.txt', JSON.stringify(foundProducts, null, 2));
          process.stdout.write('\nРезультаты успешно записаны в found_products.txt\n');
        }
      }
    });
}

main().catch(console.error);
