const VIETNAM_TIME_ZONE = 7;
const PI = Math.PI;
const SYNODIC_MONTH = 29.530588853;

export type VietnameseLunarDate = {
  day: number;
  month: number;
  year: number;
  isLeapMonth: boolean;
};

function julianDayNumber(day: number, month: number, year: number) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  const dayNumber = day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  return dayNumber < 2299161
    ? day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083
    : dayNumber;
}

function newMoon(k: number) {
  const t = k / 1236.85;
  const t2 = t * t;
  const t3 = t2 * t;
  const degrees = PI / 180;
  const jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * t2 - 0.000000155 * t3
    + 0.00033 * Math.sin((166.56 + 132.87 * t - 0.009173 * t2) * degrees);
  const meanSun = 359.2242 + 29.10535608 * k - 0.0000333 * t2 - 0.00000347 * t3;
  const meanMoon = 306.0253 + 385.81691806 * k + 0.0107306 * t2 + 0.00001236 * t3;
  const moonArgument = 21.2964 + 390.67050646 * k - 0.0016528 * t2 - 0.00000239 * t3;
  const correction = (0.1734 - 0.000393 * t) * Math.sin(meanSun * degrees)
    + 0.0021 * Math.sin(2 * meanSun * degrees)
    - 0.4068 * Math.sin(meanMoon * degrees)
    + 0.0161 * Math.sin(2 * meanMoon * degrees)
    - 0.0004 * Math.sin(3 * meanMoon * degrees)
    + 0.0104 * Math.sin(2 * moonArgument * degrees)
    - 0.0051 * Math.sin((meanSun + meanMoon) * degrees)
    - 0.0074 * Math.sin((meanSun - meanMoon) * degrees)
    + 0.0004 * Math.sin((2 * moonArgument + meanSun) * degrees)
    - 0.0004 * Math.sin((2 * moonArgument - meanSun) * degrees)
    - 0.0006 * Math.sin((2 * moonArgument + meanMoon) * degrees)
    + 0.0010 * Math.sin((2 * moonArgument - meanMoon) * degrees)
    + 0.0005 * Math.sin((2 * meanMoon + meanSun) * degrees);
  const deltaT = t < -11
    ? 0.001 + 0.000839 * t + 0.0002261 * t2 - 0.00000845 * t3 - 0.000000081 * t2 * t2
    : -0.000278 + 0.000265 * t + 0.000262 * t2;
  return jd1 + correction - deltaT;
}

function newMoonDay(k: number) {
  return Math.floor(newMoon(k) + 0.5 + VIETNAM_TIME_ZONE / 24);
}

function sunLongitudeSector(julianDay: number) {
  const t = (julianDay - 2451545) / 36525;
  const t2 = t * t;
  const degrees = PI / 180;
  const meanSun = 357.5291 + 35999.0503 * t - 0.0001559 * t2 - 0.00000048 * t * t2;
  const meanLongitude = 280.46645 + 36000.76983 * t + 0.0003032 * t2;
  const correction = (1.9146 - 0.004817 * t - 0.000014 * t2) * Math.sin(meanSun * degrees)
    + (0.019993 - 0.000101 * t) * Math.sin(2 * meanSun * degrees)
    + 0.00029 * Math.sin(3 * meanSun * degrees);
  let longitude = (meanLongitude + correction) * degrees;
  longitude -= 2 * PI * Math.floor(longitude / (2 * PI));
  return Math.floor(longitude / PI * 6);
}

function sunLongitudeAtLocalMidnight(dayNumber: number) {
  return sunLongitudeSector(dayNumber - 0.5 - VIETNAM_TIME_ZONE / 24);
}

function lunarMonthEleven(year: number) {
  const offset = julianDayNumber(31, 12, year) - 2415021;
  const k = Math.floor(offset / SYNODIC_MONTH);
  let monthStart = newMoonDay(k);
  if (sunLongitudeAtLocalMidnight(monthStart) >= 9) monthStart = newMoonDay(k - 1);
  return monthStart;
}

function leapMonthOffset(monthEleven: number) {
  const k = Math.floor(0.5 + (monthEleven - 2415021.076998695) / SYNODIC_MONTH);
  let lastSector = 0;
  let month = 1;
  let sector = sunLongitudeAtLocalMidnight(newMoonDay(k + month));
  do {
    lastSector = sector;
    month += 1;
    sector = sunLongitudeAtLocalMidnight(newMoonDay(k + month));
  } while (sector !== lastSector && month < 14);
  return month - 1;
}

export function solarToVietnameseLunar(day: number, month: number, year: number): VietnameseLunarDate {
  const dayNumber = julianDayNumber(day, month, year);
  const k = Math.floor((dayNumber - 2415021.076998695) / SYNODIC_MONTH);
  let monthStart = newMoonDay(k + 1);
  if (monthStart > dayNumber) monthStart = newMoonDay(k);

  let monthEleven = lunarMonthEleven(year);
  let nextMonthEleven = monthEleven;
  let lunarYear: number;
  if (monthEleven >= monthStart) {
    lunarYear = year;
    monthEleven = lunarMonthEleven(year - 1);
  } else {
    lunarYear = year + 1;
    nextMonthEleven = lunarMonthEleven(year + 1);
  }

  const lunarDay = dayNumber - monthStart + 1;
  const monthDifference = Math.floor((monthStart - monthEleven) / 29);
  let lunarMonth = monthDifference + 11;
  let isLeapMonth = false;
  if (nextMonthEleven - monthEleven > 365) {
    const leapOffset = leapMonthOffset(monthEleven);
    if (monthDifference >= leapOffset) {
      lunarMonth = monthDifference + 10;
      isLeapMonth = monthDifference === leapOffset;
    }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && monthDifference < 4) lunarYear -= 1;

  return { day: lunarDay, month: lunarMonth, year: lunarYear, isLeapMonth };
}

export function vietnameseLunarYearName(year: number) {
  const heavenlyStems = ["Giáp", "Ất", "Bính", "Đinh", "Mậu", "Kỷ", "Canh", "Tân", "Nhâm", "Quý"];
  const earthlyBranches = ["Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ", "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"];
  const stem = ((year - 4) % 10 + 10) % 10;
  const branch = ((year - 4) % 12 + 12) % 12;
  return `${heavenlyStems[stem]} ${earthlyBranches[branch]}`;
}
