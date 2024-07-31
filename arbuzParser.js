import puppeteer from 'puppeteer';
import axios from 'axios';
import cheerio from 'cheerio';
import fs from 'fs';
import { decode } from 'html-entities';

const categoryUrls = [
    // 'https://arbuz.kz/ru/almaty/catalog/cat/225165-hleb_vypechka',
    //   'https://arbuz.kz/ru/almaty/catalog/cat/225161-moloko_syr_maslo_yaica',
    //   'https://arbuz.kz/ru/almaty/catalog/cat/225268-fermerskaya_lavka',
    //   'https://arbuz.kz/ru/almaty/catalog/cat/225162-myaso_ptica',
    //   'https://arbuz.kz/ru/almaty/catalog/cat/225163-ryba_i_moreprodukty',
    //   'https://arbuz.kz/ru/almaty/catalog/cat/225167-kolbasy',
    //   'https://arbuz.kz/ru/almaty/catalog/cat/225253-kulinariya',
    //   'https://arbuz.kz/ru/almaty/catalog/cat/225183-zamorozhennye_produkty',
    //   'https://arbuz.kz/ru/almaty/catalog/cat/225244-rastitelnye_produkty',
    //   'https://arbuz.kz/ru/almaty/catalog/cat/225170-kuhni_narodov_mira',
      'https://arbuz.kz/ru/almaty/catalog/cat/225164-svezhie_ovoshi_i_frukty',
    // 'https://arbuz.kz/ru/almaty/catalog/cat/225168-dlya_gotovki_i_vypechki', 
        //  'https://arbuz.kz/ru/almaty/catalog/cat/225169-krupy_konservy_sneki',

    //   'https://arbuz.kz/ru/almaty/catalog/cat/225075-zdorove', //5+
    //   'https://arbuz.kz/ru/almaty/catalog/cat/14-napitki',
    //   'https://arbuz.kz/ru/almaty/catalog/cat/225166-sladosti',
];

// const isDiabeticFriendly = (nutritionalValues, composition) => {
//     const maxCarbs = 10; // Максимально допустимое количество углеводов (г) на 100 г продукта
//     const forbiddenIngredients = ["сахар", "глюкоза", "фруктоза", "маргарин"];

//     // Проверка углеводов
//     if (nutritionalValues.carbs && parseFloat(nutritionalValues.carbs) > maxCarbs) {
//         return false;
//     }

//     // Проверка ингредиентов
//     for (const ingredient of forbiddenIngredients) {
//         if (composition.toLowerCase().includes(ingredient)) {
//             return false;
//         }
//     }

//     return true;
// };

const scrapeProductDetails = async (productUrl) => {
    try {
        const response = await axios.get(productUrl);
        const data = response.data;

        let jsonString = data.match(/:product-transformed="\{.*?\}"/);
        if (jsonString) {
            jsonString = jsonString[0].replace(':product-transformed=', '').replace(/&quot;/g, '"').slice(1, -1);
            let productData = JSON.parse(jsonString);

            function decodeHtml(html) {
                const $ = cheerio.load(html);
                return decode($.text().trim()).replace(/<[^>]+>/g, '').trim();
            }

            let description = decodeHtml(productData.information || 'Description not found or not provided');
            let composition = decodeHtml(productData.ingredients || '');

            if (!composition && (description.includes('Состав') || description.includes('Ингредиенты'))) {
                let compositionIndex = description.includes('Состав') ? description.indexOf('Состав') : description.indexOf('Ингредиенты');
                composition = description.slice(compositionIndex).split(/Пищевая|Энергетическая ценность|Пищевая и энергетическая ценность/)[0].replace(/Состав:|Ингредиенты:/, '').trim();
            }

            let nutritionalValues = productData.nutrition || {};
            if (Object.keys(nutritionalValues).length === 0 && (description.includes('Пищевая ценность') || description.includes('Энергетическая ценность') || description.includes('Пищевая и энергетическая ценность'))) {
                nutritionalValues = {};
                const nutritionalRegex = /(?:Энергетическая ценность|Пищевая ценность|Пищевая и энергетическая ценность)[^:]*:\s*([^:]*)(?:\s*на\s*\d+\s*г\s*продукта)?/gi;
                let match;
                while ((match = nutritionalRegex.exec(description)) !== null) {
                    const section = match[1];
                    const values = section.match(/([а-яА-ЯёЁ]+)\s*([0-9]+(?:,\d+)?)/gi);
                    if (values) {
                        values.forEach(value => {
                            const parts = value.match(/([а-яА-ЯёЁ]+)\s*([0-9]+(?:,\d+)?)/).slice(1, 3);
                            const key = parts[0];
                            const val = parts[1].replace(',', '.');
                            if (key.includes('белки')) nutritionalValues.protein = val;
                            if (key.includes('жиры')) nutritionalValues.fats = val;
                            if (key.includes('углеводы')) nutritionalValues.carbs = val;
                        });
                    }

                    const kcalMatch = section.match(/([0-9]+(?:,\d+)?)\s*кКал/);
                    if (kcalMatch) {
                        nutritionalValues.kcal = kcalMatch[1].replace(',', '.');
                    }
                }
            }

            const result = {};

            if (composition !== '') {
                result.composition = composition;
            }

            if (Object.keys(nutritionalValues).length > 0) {
                result.nutritionalValues = `protein: ${nutritionalValues.protein || 'N/A'}, fats: ${nutritionalValues.fats || 'N/A'}, carbs: ${nutritionalValues.carbs || 'N/A'}, kcal: ${nutritionalValues.kcal || 'N/A'}`;
            }

            return Object.keys(result).length > 0 ? result : null;
            // if (isDiabeticFriendly(nutritionalValues, composition)) {
            //     return Object.keys(result).length > 0 ? { result} : null;
            // } else {
            //     return null;
            // }
        } else {
            console.log("JSON data not found");
            return null;
        }
    } catch (error) {
        console.error(`Error fetching product details from ${productUrl}:`, error);
        return null;
    }
};

const scrapeProductDetailsFromCategory = async (page, categoryUrl, uniqueUrls, startPage, maxPages) => {
    const products = [];

    await page.goto(categoryUrl, { waitUntil: 'networkidle2', timeout: 300000 });
    await page.waitForSelector('.product-item', { timeout:90000 });

    let hasNextPage = true;
    let pageCount = 0;
    let currentPage = 0;
    
    while (hasNextPage && pageCount < maxPages) {
        if (currentPage >= startPage) {
            const pageProducts = await page.evaluate(() => {
                const productElements = document.querySelectorAll('.product-item');
                const productData = [];

                productElements.forEach(element => {
                    const nameElement = element.querySelector('.product-card__title');
                    const priceElement = element.querySelector('.price--wrapper');
                    const productLink = nameElement ? nameElement.getAttribute('href') : null;

                    if (nameElement && priceElement && productLink) {
                        const title = nameElement.textContent.trim();
                        const price = priceElement.textContent.replace('₸', '').trim();
                        const url = `https://arbuz.kz${productLink}`;

                        productData.push({ title, price, url });
                    }
                });

                return productData;
            });

        for (const product of pageProducts) {
            if (!uniqueUrls.has(product.url)) {
                const details = await scrapeProductDetails(product.url);
                if (details) {
                    products.push({ ...product, ...details });
                    uniqueUrls.add(product.url);
                }
            }
        }
        pageCount++;
        }
        

        hasNextPage = await page.evaluate(() => {
            const showMoreButton = document.querySelector('.arbuz-pagination-show-more');
            if (showMoreButton) {
                showMoreButton.click();
                return true;
            } else {
                return false;
            }
        });

        if (hasNextPage) {
            await new Promise(r => setTimeout(r, 3000));
            await page.waitForSelector('.product-item', { visible: true, timeout: 60000 });
            currentPage++;
        }
    }

    return products;
};

const scrapeAllProductDetails = async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    let allProducts = [];
    let uniqueUrls = new Set();

  

    if (fs.existsSync('products.json')) {
        const existingData = fs.readFileSync('products.json', 'utf8');
        const existingProducts = existingData.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line));
        allProducts = existingProducts;
        uniqueUrls = new Set(existingProducts.map(product => product.url));
    }
    
    for (const categoryUrl of categoryUrls) {
        console.log(`Scraping product details for category: ${categoryUrl}`);
        const categoryProducts = await scrapeProductDetailsFromCategory(page, categoryUrl, uniqueUrls, 0, 11);
        allProducts.push(...categoryProducts);
        fs.writeFileSync('products.json', allProducts.map(product => JSON.stringify(product)).join('\n'), 'utf8');
    }
    

    await browser.close();

    console.log('Products saved to products.json');
};

scrapeAllProductDetails();

