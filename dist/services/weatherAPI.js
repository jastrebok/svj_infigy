"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchWeather = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const axios_1 = __importDefault(require("axios"));
dotenv_1.default.config();
const API_KEY = process.env.API_WEATHER;
if (!API_KEY) {
    throw new Error("API_WEATHER key is missing in environment variables.");
}
/**
 * Fetches weather data from OpenWeatherMap API
 * @param lat Latitude of the location
 * @param lon Longitude of the location
 * @returns Weather data response from the API
 */
const fetchWeather = async (lat, lon) => {
    try {
        const url = `https://api.openweathermap.org/data/3.0/onecall`;
        const response = await axios_1.default.get(url, {
            params: {
                lat,
                lon,
                appid: API_KEY,
                units: 'metric'
            }
        });
        return response.data;
    }
    catch (error) {
        console.error("Error fetching weather data:", error);
        throw error;
    }
};
exports.fetchWeather = fetchWeather;
