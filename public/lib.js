const WMO = {
  0:  { icon: '☀️', desc: 'Clear sky' },
  1:  { icon: '🌤️', desc: 'Mainly clear' },
  2:  { icon: '⛅', desc: 'Partly cloudy' },
  3:  { icon: '☁️', desc: 'Overcast' },
  45: { icon: '🌫️', desc: 'Fog' },
  48: { icon: '🌫️', desc: 'Rime fog' },
  51: { icon: '🌦️', desc: 'Light drizzle' },
  53: { icon: '🌦️', desc: 'Drizzle' },
  55: { icon: '🌦️', desc: 'Heavy drizzle' },
  56: { icon: '🌧️', desc: 'Freezing drizzle' },
  57: { icon: '🌧️', desc: 'Freezing drizzle' },
  61: { icon: '🌧️', desc: 'Light rain' },
  63: { icon: '🌧️', desc: 'Rain' },
  65: { icon: '🌧️', desc: 'Heavy rain' },
  66: { icon: '🌧️', desc: 'Freezing rain' },
  67: { icon: '🌧️', desc: 'Freezing rain' },
  71: { icon: '🌨️', desc: 'Light snow' },
  73: { icon: '🌨️', desc: 'Snow' },
  75: { icon: '❄️', desc: 'Heavy snow' },
  77: { icon: '🌨️', desc: 'Snow grains' },
  80: { icon: '🌦️', desc: 'Rain showers' },
  81: { icon: '🌧️', desc: 'Rain showers' },
  82: { icon: '⛈️', desc: 'Violent showers' },
  85: { icon: '🌨️', desc: 'Snow showers' },
  86: { icon: '🌨️', desc: 'Snow showers' },
  95: { icon: '⛈️', desc: 'Thunderstorm' },
  96: { icon: '⛈️', desc: 'Thunderstorm + hail' },
  99: { icon: '⛈️', desc: 'Thunderstorm + hail' },
};

export const codeMeta = (c) => WMO[c] ?? { icon: '🌡️', desc: '—' };

export const formatDate = (d) => d.toLocaleDateString(undefined, {
  weekday: 'long', month: 'long', day: 'numeric',
});

export const parseQuery = (raw) => {
  const [name, country] = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { name, country: country?.toUpperCase() };
};

/** Wall-clock "YYYY-MM-DDTHH" key in `timezone` for the given instant.
 *  Used to align Open-Meteo's tz-naive hourly timestamps with "now". */
export const nowKey = (timezone, date = new Date()) => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour.padStart(2, '0')}`;
};

/** Open-Meteo hourly arrays → array of UI hour objects, with isNow/isPast flags
 *  computed against `now` (the "YYYY-MM-DDTHH" key of the current hour). */
export const mapHourly = (data, now) => {
  const { time, temperature_2m, weather_code, precipitation_probability, wind_speed_10m } = data;
  return time.map((t, i) => {
    const meta = codeMeta(weather_code[i]);
    const hourKey = t.slice(0, 13);
    return {
      time: t,
      label: t.slice(11, 16),
      temp: Math.round(temperature_2m[i]),
      icon: meta.icon,
      desc: meta.desc,
      precipProb: precipitation_probability?.[i] ?? 0,
      wind: Math.round(wind_speed_10m[i]),
      isNow: hourKey === now,
      isPast: hourKey < now,
    };
  });
};
