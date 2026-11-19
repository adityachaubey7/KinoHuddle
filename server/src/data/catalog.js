/**
 * Curated catalog. Every entry is an official upload on YouTube whose owner allows
 * embedding (verified via YouTube oEmbed). Blender Studio films are released under
 * Creative Commons licences; anime entries are official trailers from their distributors.
 *
 * To add a title: append an object with a unique `slug` and the `youtubeId`.
 */
export const catalog = [
  // ---------- Movies ----------
  {
    slug: 'tears-of-steel',
    title: 'Tears of Steel',
    category: 'movies',
    kind: 'Short film',
    year: 2012,
    minutes: 12,
    genres: ['Sci-fi', 'Action'],
    youtubeId: 'R6MlUcmOul8',
    channel: 'Blender',
    synopsis:
      'In a future Amsterdam, a group of warriors and scientists stage a desperate last stand against giant robots, hoping to fix one broken relationship from the past.',
  },
  {
    slug: 'sintel',
    title: 'Sintel',
    category: 'movies',
    kind: 'Short film',
    year: 2010,
    minutes: 15,
    genres: ['Fantasy', 'Adventure'],
    youtubeId: 'eRsGyueVLvQ',
    channel: 'Blender',
    synopsis:
      'A lonely young woman searches the wintry mountains for the baby dragon she once rescued and raised, and finds something she was not prepared for.',
  },
  {
    slug: 'cosmos-laundromat',
    title: 'Cosmos Laundromat',
    category: 'movies',
    kind: 'Short film',
    year: 2015,
    minutes: 12,
    genres: ['Comedy', 'Surreal'],
    youtubeId: 'Y-rmzh0PI3c',
    channel: 'Blender',
    synopsis:
      'On a desolate island, a suicidal sheep named Franck meets a mysterious salesman who offers him the gift of a lifetime — many lifetimes, in fact.',
  },
  {
    slug: 'elephants-dream',
    title: 'Elephants Dream',
    category: 'movies',
    kind: 'Short film',
    year: 2006,
    minutes: 11,
    genres: ['Surreal', 'Sci-fi'],
    youtubeId: 'TLkA0RELQ1g',
    channel: 'Blender',
    synopsis:
      'Two men explore a vast, shifting machine. One believes he understands it; the other is starting to doubt everything he has been shown.',
  },
  {
    slug: 'agent-327',
    title: 'Agent 327: Operation Barbershop',
    category: 'movies',
    kind: 'Short film',
    year: 2017,
    minutes: 4,
    genres: ['Action', 'Comedy'],
    youtubeId: 'mN0zPOpADL4',
    channel: 'Blender Studio',
    synopsis:
      'A Dutch secret agent goes undercover in a barbershop that hides far more than hair tonic — and a very dangerous barber.',
  },
  {
    slug: 'charge',
    title: 'Charge',
    category: 'movies',
    kind: 'Short film',
    year: 2022,
    minutes: 4,
    genres: ['Action', 'Sci-fi'],
    youtubeId: 'UXqq0ZvbOnk',
    channel: 'Blender Studio',
    synopsis:
      'In a dystopian energy crisis, an old man breaks into a battery facility, and the robot guarding it is not about to let him leave.',
  },
  {
    slug: 'spring',
    title: 'Spring',
    category: 'movies',
    kind: 'Short film',
    year: 2019,
    minutes: 8,
    genres: ['Fantasy', 'Drama'],
    youtubeId: 'WhWc3b3KhnY',
    channel: 'Blender Studio',
    synopsis:
      'A shepherd girl and her dog face ancient spirits to bring the cycle of life back to a frozen mountain.',
  },

  // ---------- Anime ----------
  {
    slug: 'your-name-trailer',
    title: 'Your Name',
    category: 'anime',
    kind: 'Official trailer',
    year: 2016,
    minutes: 2,
    genres: ['Romance', 'Drama'],
    youtubeId: 'xU47nhruN-Q',
    channel: 'All the Anime',
    synopsis:
      'Two teenagers who have never met begin waking up in each other’s bodies. Makoto Shinkai’s film, in its official subtitled trailer.',
  },
  {
    slug: 'spirited-away-trailer',
    title: 'Spirited Away',
    category: 'anime',
    kind: 'Official trailer',
    year: 2001,
    minutes: 2,
    genres: ['Fantasy', 'Adventure'],
    youtubeId: 'ByXuk9QqQkk',
    channel: 'Crunchyroll Store Australia',
    synopsis:
      'Chihiro wanders into a world of spirits and must work in a bathhouse for witches to free her parents. Studio Ghibli’s classic, in trailer form.',
  },
  {
    slug: 'mugen-train-trailer',
    title: 'Demon Slayer: Mugen Train',
    category: 'anime',
    kind: 'Official trailer',
    year: 2020,
    minutes: 2,
    genres: ['Action', 'Fantasy'],
    youtubeId: 'ATJYac_dORw',
    channel: 'Aniplex USA',
    synopsis:
      'Tanjiro and his companions board a train where passengers keep vanishing, alongside the Flame Hashira Rengoku.',
  },

  // ---------- Cartoons ----------
  {
    slug: 'big-buck-bunny',
    title: 'Big Buck Bunny',
    category: 'cartoons',
    kind: 'Short film',
    year: 2008,
    minutes: 10,
    genres: ['Comedy', 'Family'],
    youtubeId: 'aqz-KE-bpKQ',
    channel: 'Blender',
    synopsis:
      'A giant, gentle rabbit is pushed too far by three bullying rodents, and plans an elaborate, cartoonish revenge.',
  },
  {
    slug: 'sprite-fright',
    title: 'Sprite Fright',
    category: 'cartoons',
    kind: 'Short film',
    year: 2021,
    minutes: 10,
    genres: ['Comedy', 'Horror'],
    youtubeId: '_cMxraX_5RE',
    channel: 'Blender Studio',
    synopsis:
      'A group of rowdy teenagers on a woodland trip meet some adorable mushroom sprites. That turns out to be a mistake.',
  },
  {
    slug: 'coffee-run',
    title: 'Coffee Run',
    category: 'cartoons',
    kind: 'Short film',
    year: 2020,
    minutes: 3,
    genres: ['Drama', 'Family'],
    youtubeId: 'PVGeM40dABA',
    channel: 'Blender Studio',
    synopsis:
      'Fueled by caffeine, a young woman runs through the bittersweet memories of her past relationship.',
  },
  {
    slug: 'wing-it',
    title: 'Wing It!',
    category: 'cartoons',
    kind: 'Short film',
    year: 2023,
    minutes: 4,
    genres: ['Comedy', 'Family'],
    youtubeId: 'u9lj-c29dxI',
    channel: 'Blender Studio',
    synopsis:
      'A rooster and a cat attempt a homemade rocket launch from a farmyard. Safety is not their strongest skill.',
  },
  {
    slug: 'caminandes-llamigos',
    title: 'Caminandes 3: Llamigos',
    category: 'cartoons',
    kind: 'Short film',
    year: 2016,
    minutes: 3,
    genres: ['Comedy', 'Family'],
    youtubeId: 'SkVqJ1SGeL0',
    channel: 'Blender',
    synopsis:
      'Koro the llama meets a penguin in Patagonia, and the two compete for the very last berries of winter.',
  },
  {
    slug: 'glass-half',
    title: 'Glass Half',
    category: 'cartoons',
    kind: 'Short film',
    year: 2015,
    minutes: 3,
    genres: ['Comedy'],
    youtubeId: 'lqiN98z6Dak',
    channel: 'Blender',
    synopsis:
      'Two art critics at a gallery cannot agree on anything — least of all whether the glass is half full.',
  },
  {
    slug: 'hero',
    title: 'Hero',
    category: 'cartoons',
    kind: 'Short film',
    year: 2018,
    minutes: 4,
    genres: ['Action', 'Fantasy'],
    youtubeId: 'pKmSdY56VtY',
    channel: 'Blender',
    synopsis:
      'A hand-drawn chase across a crumbling fantasy world, made entirely with Blender’s Grease Pencil 2D tools.',
  },
];

export const categories = ['movies', 'anime', 'cartoons'];
export const genres = [...new Set(catalog.flatMap((t) => t.genres))].sort();
export const bySlug = new Map(catalog.map((t) => [t.slug, t]));
