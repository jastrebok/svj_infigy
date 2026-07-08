import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// ---------------------------------------------------------------------------
// SolaXCloud API v2 – Real-time inverter data
// Docs: SolaXCloud User API V2.0
// Endpoint: POST /api/v2/dataAccess/realtimeInfo/get
// Auth:     tokenId in HTTP header
// ---------------------------------------------------------------------------

const BASE_URL = (process.env.SOLAX_API ?? 'https://global.solaxcloud.com').replace(/\/$/, '');
const TOKEN_ID = process.env.SOLAX_API_KEY ?? '';
const WIFI_SN  = process.env.SOLAX_WIFI_SN  ?? '';

// ---- Types -----------------------------------------------------------------

export interface SolaxRealtimeResult {
  inverterSN:     string | null;
  sn:             string | null;   // Wi-Fi module SN
  acpower:        number | null;   // W  – AC output power
  yieldtoday:     number | null;   // kWh – today's yield
  yieldtotal:     number | null;   // kWh – total yield
  feedinpower:    number | null;   // W  – power exported to grid (negative = import)
  feedinenergy:   number | null;   // kWh – total exported energy
  consumeenergy:  number | null;   // kWh – total consumed energy
  feedinpowerM2:  number | null;   // W  – meter 2 power
  soc:            number | null;   // %  – battery state of charge
  peps1:          number | null;   // W  – EPS phase A
  peps2:          number | null;   // W  – EPS phase B
  peps3:          number | null;   // W  – EPS phase C
  inverterType:   string | null;
  inverterStatus: string | null;
  uploadTime:     string | null;
  batPower:       number | null;   // W  – battery terminal power (+ charge / – discharge)
  powerdc1:       number | null;   // W  – PV string 1
  powerdc2:       number | null;   // W  – PV string 2
  powerdc3:       number | null;   // W  – PV string 3
  powerdc4:       number | null;   // W  – PV string 4
  batStatus:      string | null;   // "0"=normal "1"=fault "2"=disconnected
  utcDateTime:    string | null;
}

export interface SolaxRealtimeResponse {
  success:   boolean;
  exception: string;
  result:    SolaxRealtimeResult | null;
  code:      number;
}

// Inverter status code → human-readable label (Appendix 8.1)
export const INVERTER_STATUS: Record<string, string> = {
  '100': 'Waiting for operation',
  '101': 'Self-test',
  '102': 'Normal',
  '103': 'Recoverable fault',
  '104': 'Permanent fault',
  '105': 'Firmware upgrade',
  '106': 'EPS detection',
  '107': 'Off-grid',
  '108': 'Self-test mode (IT)',
  '109': 'Sleep mode',
  '110': 'Standby mode',
  '111': 'PV wake-up battery mode',
  '112': 'Generator detection mode',
  '113': 'Generator mode',
  '114': 'Fast shutdown standby mode',
  '130': 'VPP mode',
  '131': 'TOU-Self use',
  '132': 'TOU-Charging',
  '133': 'TOU-Discharging',
  '134': 'TOU-Battery off',
  '135': 'TOU-Peak Shaving',
  '136': 'Normal generator operation mode',
  '137': 'Battery expansion mode',
  '138': 'On-grid battery heating mode',
  '139': 'EPS battery heating mode',
  '150': 'Self Use',
  '151': 'Force Time Use',
  '152': 'Back Up Mode',
  '153': 'Feedin Priority',
  '154': 'Demand Mode',
  '155': 'ConstPowr Mode',
  '160': 'OpenAdr Mode',
};

// ---- API call --------------------------------------------------------------

/**
 * Fetches real-time inverter data from SolaXCloud.
 *
 * @param wifiSn  WiFi/pocket device registration number (SOLAX_WIFI_SN env var used if omitted)
 * @returns       Raw API response
 */
export async function fetchSolaxRealtime(wifiSn?: string): Promise<SolaxRealtimeResponse> {
  const sn = wifiSn ?? WIFI_SN;
  if (!sn) {
    throw new Error('SOLAX_WIFI_SN is not set. Add it to your .env file.');
  }
  if (!TOKEN_ID) {
    throw new Error('SOLAX_API_KEY is not set. Add it to your .env file.');
  }

  const url = `${BASE_URL}/api/v2/dataAccess/realtimeInfo/get`;

  const response = await axios.post<SolaxRealtimeResponse>(
    url,
    { wifiSn: sn },
    {
      headers: {
        'Content-Type': 'application/json',
        tokenId: TOKEN_ID,        // required by the API spec (section 5.1)
      },
      timeout: 15_000,
    }
  );

  return response.data;
}

// ---- Mapper: SolaX → infigy power object ----------------------------------

/**
 * Maps a SolaX real-time result to the same shape used by the existing
 * `extractPowerData` Playwright scraper, so all downstream code
 * (scenario conditions, storage, UI) works without changes.
 *
 * Variable mapping:
 *   Photovoltaics  ← powerdc1 + powerdc2 + powerdc3 + powerdc4 (total PV input, W)
 *   Battery        ← batPower  (W, positive = charging, negative = discharging)
 *   Grid           ← feedinpower (W, positive = export, negative = import)
 *   House          ← acpower   (W, AC output / consumption)
 *   Battery_status ← soc       (%, state of charge)
 */
export function solaxToPowerMap(r: SolaxRealtimeResult): Record<string, string | null> {
  const pvTotal =
    (r.powerdc1 ?? 0) +
    (r.powerdc2 ?? 0) +
    (r.powerdc3 ?? 0) +
    (r.powerdc4 ?? 0);

  const fmt = (n: number | null, unit = 'W'): string | null => {
    if (n === null) return null;
    return `${n} ${unit}`;
  };

  return {
    Photovoltaics:  fmt(pvTotal),
    Battery:        fmt(r.batPower),
    Grid:           fmt(r.feedinpower),
    House:          fmt(r.acpower),
    Battery_status: r.soc !== null ? `${r.soc}%` : null,
    // extra SolaX-specific values – available in scenario conditions via power['key']
    inverterStatus: r.inverterStatus
      ? (INVERTER_STATUS[r.inverterStatus] ?? r.inverterStatus)
      : null,
    yieldToday:    fmt(r.yieldtoday, 'kWh'),
    yieldTotal:    fmt(r.yieldtotal, 'kWh'),
    feedinEnergy:  fmt(r.feedinenergy, 'kWh'),
    consumeEnergy: fmt(r.consumeenergy, 'kWh'),
  };
}

/**
 * High-level helper: fetch real-time data and return
 *   { power, battery_cap, inverterStatus }
 * ready to be stored in latestPower / latestWeather.
 */
export async function getSolaxPowerData(wifiSn?: string): Promise<{
  power: Record<string, string | null>;
  battery_cap: number | null;
  inverterStatus: string | null;
  raw: SolaxRealtimeResult;
}> {
  const res = await fetchSolaxRealtime(wifiSn);

  if (!res.success || !res.result) {
    throw new Error(`SolaX API error (code ${res.code}): ${res.exception}`);
  }

  const power = solaxToPowerMap(res.result);
  const battery_cap = res.result.soc ?? null;
  const inverterStatus = res.result.inverterStatus
    ? (INVERTER_STATUS[res.result.inverterStatus] ?? res.result.inverterStatus)
    : null;

  return { power, battery_cap, inverterStatus, raw: res.result };
}
