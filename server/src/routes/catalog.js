import { Router } from 'express';
import { z } from 'zod';
import { catalog, categories, genres, bySlug } from '../data/catalog.js';
import { validate, HttpError } from '../lib/http.js';

const router = Router();

const querySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.enum(['all', ...categories]).optional(),
  genre: z.string().max(40).optional(),
  length: z.enum(['any', 'short', 'medium']).optional(), // short < 5 min, medium >= 5 min
  sort: z.enum(['featured', 'newest', 'oldest', 'title']).optional(),
});

router.get('/', validate(querySchema, 'query'), (req, res) => {
  const { q, category = 'all', genre, length = 'any', sort = 'featured' } = req.validQuery;
  let items = catalog.slice();
  if (category !== 'all') items = items.filter((t) => t.category === category);
  if (genre && genre !== 'all') items = items.filter((t) => t.genres.includes(genre));
  if (length === 'short') items = items.filter((t) => t.minutes < 5);
  if (length === 'medium') items = items.filter((t) => t.minutes >= 5);
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((t) =>
      [t.title, t.synopsis, t.channel, ...t.genres].some((s) => s.toLowerCase().includes(needle))
    );
  }
  if (sort === 'newest') items.sort((a, b) => b.year - a.year);
  if (sort === 'oldest') items.sort((a, b) => a.year - b.year);
  if (sort === 'title') items.sort((a, b) => a.title.localeCompare(b.title));
  res.json({ items, total: items.length, categories, genres });
});

router.get('/:slug', (req, res, next) => {
  const title = bySlug.get(req.params.slug);
  if (!title) return next(new HttpError(404, 'TITLE_NOT_FOUND', 'That title isn’t in the catalog.'));
  const related = catalog
    .filter((t) => t.slug !== title.slug && (t.category === title.category || t.genres.some((g) => title.genres.includes(g))))
    .slice(0, 6);
  res.json({ item: title, related });
});

export default router;
