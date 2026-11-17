import type { Point2D } from '../types/bending';

const EPS = 1e-8;

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function onSegment(a: Point2D, b: Point2D, p: Point2D): boolean {
  return Math.abs(orientation(a, b, p)) < EPS &&
    p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS;
}
export function edgesIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const o1 = orientation(a, b, c), o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a), o4 = orientation(c, d, b);
  if ((o1 > EPS && o2 < -EPS || o1 < -EPS && o2 > EPS) &&
      (o3 > EPS && o4 < -EPS || o3 < -EPS && o4 > EPS)) return true;
  return (Math.abs(o1) <= EPS && onSegment(a, b, c)) ||
    (Math.abs(o2) <= EPS && onSegment(a, b, d)) ||
    (Math.abs(o3) <= EPS && onSegment(c, d, a)) ||
    (Math.abs(o4) <= EPS && onSegment(c, d, b));
}

/** Detects self-intersections and invalid dimensions of user-entered tool profiles. */
export function validateProfile(points: Point2D[]): string | null {
  if (points.length < 3 || points.length > 250) return 'Profil wymaga 3–250 punktów.';
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
      Math.abs(p.x) > 5000 || Math.abs(p.y) > 5000)) return 'Nieprawidłowe współrzędne (maks. 5000 mm).';
  const area = points.reduce((acc, p, i) => {
    const next = points[(i + 1) % points.length];
    return acc + p.x * next.y - next.x * p.y;
  }, 0);
  if (Math.abs(area) < 1e-4) return 'Profil ma zerową powierzchnię.';
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-5) return 'Powtarzające się sąsiednie punkty.';
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (edgesIntersect(a, b, points[j], points[(j + 1) % points.length])) {
        return 'Obrys przecina sam siebie. Podaj punkty po obwodzie.';
      }
    }
  }
  return null;
}

export function parseProfile(text: string): Point2D[] {
  let points: Point2D[];
  if (text.trim().startsWith('[')) {
    const decoded: unknown = JSON.parse(text);
    if (!Array.isArray(decoded)) throw new Error('Oczekiwano tablicy punktów.');
    points = decoded.map((pt) => {
      if (Array.isArray(pt) && pt.length === 2) return { x: Number(pt[0]), y: Number(pt[1]) };
      if (pt && typeof pt === 'object' && 'x' in pt && 'y' in pt)
        return { x: Number(pt.x), y: Number(pt.y) };
      throw new Error('Każdy punkt powinien mieć współrzędne x,y.');
    });
  } else {
    points = text.split(/\r?\n|;/).filter((s) => s.trim()).map((line) => {
      const values = line.trim().split(/[\s,]+/).map(Number);
      if (values.length !== 2) throw new Error('Każdy wiersz powinien zawierać x i y w mm.');
      return { x: values[0], y: values[1] };
    });
  }
  const error = validateProfile(points);
  if (error) throw new Error(error);
  return points;
}

export function stringifyProfile(points: Point2D[]): string {
  return points.map((p) => `${p.x} ${p.y}`).join('\n');
}
