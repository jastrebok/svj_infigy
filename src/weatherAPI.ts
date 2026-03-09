import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const API_KEY = process.env.API_WEATHER;

if (!API_KEY) {
  throw new Error("API_WEATHER key is missing in environment variables.");
}

type HourlyWeather = {
  dt: number;
  clouds: number;
};

type WeatherResponse = {
  hourly: HourlyWeather[];
};

/**
 * Fetches weather data from OpenWeatherMap API
 * @param lat Latitude of the location
 * @param lon Longitude of the location
 * @returns Weather data response from the API
 */
export const fetchWeather = async (lat: number, lon: number): Promise<WeatherResponse> => {
  try {
    const url = `https://api.openweathermap.org/data/3.0/onecall`;
    const response = await axios.get<WeatherResponse>(url, {
      params: {
        lat,
        lon,
        appid: API_KEY
      }
    });
    return response.data;
  } catch (error) {
    console.error("Error fetching weather data:", error);
    throw error;
  }
};