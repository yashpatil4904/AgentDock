import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createMcpApp, isDirectRun, listen } from "./http.js";

interface GeoResult {
  results?: Array<{ name: string; country?: string; latitude: number; longitude: number; timezone?: string }>;
}

interface ForecastResult {
  current?: { temperature_2m?: number; weather_code?: number; time?: string };
  current_units?: { temperature_2m?: string };
}

function text(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    isError,
  };
}

async function forecastFor(location: string) {
  const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geoUrl.searchParams.set("name", location);
  geoUrl.searchParams.set("count", "1");
  const geoResponse = await fetch(geoUrl);
  if (!geoResponse.ok) throw new Error(`Geocoding failed (${geoResponse.status})`);
  const geo = (await geoResponse.json()) as GeoResult;
  const place = geo.results?.[0];
  if (!place) throw new Error(`No location found for "${location}"`);

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(place.latitude));
  forecastUrl.searchParams.set("longitude", String(place.longitude));
  forecastUrl.searchParams.set("current", "temperature_2m,weather_code");
  forecastUrl.searchParams.set("timezone", place.timezone || "auto");
  const forecastResponse = await fetch(forecastUrl);
  if (!forecastResponse.ok) throw new Error(`Forecast failed (${forecastResponse.status})`);
  const forecast = (await forecastResponse.json()) as ForecastResult;
  return {
    location: place.name,
    country: place.country ?? "",
    latitude: place.latitude,
    longitude: place.longitude,
    time: forecast.current?.time ?? "",
    temperature: forecast.current?.temperature_2m ?? null,
    temperatureUnit: forecast.current_units?.temperature_2m ?? "°C",
    weatherCode: forecast.current?.weather_code ?? null,
  };
}

export function buildWeatherServer(): McpServer {
  const server = new McpServer({ name: "weather", version: "1.0.0" });
  server.registerTool(
    "get_forecast",
    {
      description: "Get the current temperature and WMO weather code for a city, using Open-Meteo.",
      inputSchema: {
        location: z.string().min(1).describe("City name, for example London"),
      },
    },
    async ({ location }) => {
      try {
        return text(await forecastFor(location));
      } catch (error) {
        return text({ error: error instanceof Error ? error.message : "Forecast failed" }, true);
      }
    },
  );
  return server;
}

if (isDirectRun(import.meta.url)) {
  listen(createMcpApp(buildWeatherServer), Number(process.env.PORT ?? 8080));
}
