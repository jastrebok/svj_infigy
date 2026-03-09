import puppeteer from 'puppeteer';
import dotenv from 'dotenv'

dotenv.config();

async function run() {
  const browser = await puppeteer.launch({
    headless: false, // set to true to hide the browser
    defaultViewport: null,
  });

  const page = await browser.newPage();

  // Login screen
  await page.goto('https://app.infigy.cz/auth',{waitUntil: 'networkidle2'});

  await page.waitForSelector('input[name="email"]');
  await page.type('input[name="email"]', process.env.EMAIL || '', { delay: 50 });

  await page.waitForSelector('input[name="password"]');
  await page.type('input[name="password"]', process.env.PASSWORD || '', { delay: 50 });

  // 🔐 Login button
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);

  console.log('✅ Logged in successfully!');

  //Open screen
  await page.waitForSelector('a[href^="/portal/enter/"]'); // adjust if needed
  await page.click('a[href^="/portal/enter/"]');

  // optionally wait for navigation if the link triggers a page load
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  //Plug screen
  await page.goto('https://app.infigy.cz/plug',{waitUntil: 'networkidle2'});
  //Click the plug button only when unchecked
  const isChecked = await page.$eval(
      'input[type="checkbox"].MuiSwitch-input',
      (el: HTMLInputElement) => el.checked
    );

  if (!isChecked) {
      await page.click('input[type="checkbox"].MuiSwitch-input');
    }
  // await browser.close();
}

run().catch(error => {
  console.error('Error running Puppeteer:', error);
});
