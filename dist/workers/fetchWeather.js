"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const weatherAPI_1 = require("../services/weatherAPI");
const date_fns_1 = require("date-fns");
const args = process.argv.slice(2);
const [latArg, lonArg, startArg, endArg] = args;
if (!latArg || !lonArg || !startArg || !endArg) {
    console.error("Usage: npm run fetchWeather -- <lat> <lon> <startISO> <endISO>");
    process.exit(1);
}
const lat = parseFloat(latArg);
const lon = parseFloat(lonArg);
const start = (0, date_fns_1.parseISO)(startArg);
const end = (0, date_fns_1.parseISO)(endArg);
if (isNaN(lat) || isNaN(lon) || !(0, date_fns_1.isValid)(start) || !(0, date_fns_1.isValid)(end)) {
    console.error("Invalid latitude/longitude or datetime format.");
    process.exit(1);
}
(0, weatherAPI_1.fetchWeather)(lat, lon)
    .then(data => {
    const hourly = data.hourly;
    if (!hourly || !Array.isArray(hourly)) {
        console.error("Hourly weather data not found.");
        process.exit(1);
    }
    console.log(`\n☁️ Cloud Coverage from ${startArg} to ${endArg}:\n`);
    const startUnix = Math.floor(start.getTime() / 1000);
    const endUnix = Math.floor(end.getTime() / 1000);
    const filtered = hourly.filter((h) => h.dt >= startUnix && h.dt <= endUnix);
    if (filtered.length === 0) {
        console.log("No hourly data available for this range.");
        return;
    }
    filtered.forEach((h) => {
        const time = (0, date_fns_1.format)(new Date(h.dt * 1000), 'yyyy-MM-dd HH:mm');
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
