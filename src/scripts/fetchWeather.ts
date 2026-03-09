import { fetchWeather } from '../weatherAPI';
import { parseISO, isValid, format } from 'date-fns';

const args = process.argv.slice(2);
const [latArg, lonArg, startArg, endArg] = args;

if (!latArg || !lonArg || !startArg || !endArg) {
  console.error("Usage: npm run fetchWeather -- <lat> <lon> <startISO> <endISO>");
  process.exit(1);
}

const lat = parseFloat(latArg);
const lon = parseFloat(lonArg);
const start = parseISO(startArg);
const end = parseISO(endArg);

if (isNaN(lat) || isNaN(lon) || !isValid(start) || !isValid(end)) {
  console.error("Invalid latitude/longitude or datetime format.");
  process.exit(1);
}

fetchWeather(lat, lon)
  .then(data => {
    const hourly = data.hourly;
    if (!hourly || !Array.isArray(hourly)) {
      console.error("Hourly weather data not found.");
      process.exit(1);
    }

    console.log(`\n☁️ Cloud Coverage from ${startArg} to ${endArg}:\n`);

    const startUnix = Math.floor(start.getTime() / 1000);
    const endUnix = Math.floor(end.getTime() / 1000);

    const filtered = hourly.filter((h: any) => h.dt >= startUnix && h.dt <= endUnix);

    if (filtered.length === 0) {
      console.log("No hourly data available for this range.");
      return;
    }

    filtered.forEach((h: any) => {
      const time = format(new Date(h.dt * 1000), 'yyyy-MM-dd HH:mm');
      const clouds = h.clouds;
      const uvi = h.uvi;
      console.log(`${time} → ${clouds}% cloud coverage, UV: ${uvi}`);
    });

    console.log("\n✅ Done.\n");
  })
  .catch(err => {
    console.error("❌ Failed to fetch weather data:", err.message);
    process.exit(1);
  });
