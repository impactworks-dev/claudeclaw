// Five-Minute Journal data helpers.
//
// Daily rotating gratitude / mindfulness quote (deterministic by date so
// everyone on the same date sees the same quote — no random reshuffle on
// reload). Quotes drawn from public domain + widely-attributed thinkers.

const QUOTES: Array<{ text: string; author: string }> = [
  { text: "Gratitude unlocks the fullness of life. It turns what we have into enough, and more. It turns denial into acceptance, chaos to order, confusion to clarity.", author: "Melody Beattie" },
  { text: "If you see something beautiful in someone, speak it.", author: "Ruthie Lindsey" },
  { text: "The roots of all goodness lie in the soil of appreciation for goodness.", author: "Dalai Lama" },
  { text: "Acknowledging the good that you already have in your life is the foundation for all abundance.", author: "Eckhart Tolle" },
  { text: "Gratitude is not only the greatest of virtues, but the parent of all the others.", author: "Cicero" },
  { text: "Wear gratitude like a cloak, and it will feed every corner of your life.", author: "Rumi" },
  { text: "When I started counting my blessings, my whole life turned around.", author: "Willie Nelson" },
  { text: "Enjoy the little things, for one day you may look back and realize they were the big things.", author: "Robert Brault" },
  { text: "He is a wise man who does not grieve for the things which he has not, but rejoices for those which he has.", author: "Epictetus" },
  { text: "There is a calmness to a life lived in gratitude, a quiet joy.", author: "Ralph H. Blum" },
  { text: "Gratitude turns what we have into enough.", author: "Aesop" },
  { text: "Train your mind to see the good in everything.", author: "Anonymous" },
  { text: "Joy is the simplest form of gratitude.", author: "Karl Barth" },
  { text: "The more you praise and celebrate your life, the more there is in life to celebrate.", author: "Oprah Winfrey" },
  { text: "Reflect upon your present blessings, of which every man has plenty; not on your past misfortunes, of which all men have some.", author: "Charles Dickens" },
  { text: "What we think, we become. What we feel, we attract. What we imagine, we create.", author: "Buddha" },
  { text: "The way to develop the best that is in a person is by appreciation and encouragement.", author: "Charles Schwab" },
  { text: "Gratitude makes sense of our past, brings peace for today, and creates a vision for tomorrow.", author: "Melody Beattie" },
  { text: "Walk as if you are kissing the Earth with your feet.", author: "Thich Nhat Hanh" },
  { text: "Be thankful for what you have; you'll end up having more.", author: "Oprah Winfrey" },
  { text: "Nothing is more honorable than a grateful heart.", author: "Seneca" },
  { text: "Some people grumble that roses have thorns; I am grateful that thorns have roses.", author: "Alphonse Karr" },
  { text: "When we focus on our gratitude, the tide of disappointment goes out and the tide of love rushes in.", author: "Kristin Armstrong" },
  { text: "Gratitude is the fairest blossom which springs from the soul.", author: "Henry Ward Beecher" },
  { text: "The struggle ends when the gratitude begins.", author: "Neale Donald Walsch" },
  { text: "Cultivate the habit of being grateful for every good thing that comes to you.", author: "Ralph Waldo Emerson" },
  { text: "Silent gratitude isn't very much use to anyone.", author: "Gertrude Stein" },
  { text: "An attitude of gratitude brings great things.", author: "Yogi Bhajan" },
  { text: "Today is a beautiful day; let me notice it.", author: "Marcus Aurelius (paraphrase)" },
  { text: "What lies behind us and what lies before us are tiny matters compared to what lies within us.", author: "Ralph Waldo Emerson" },
  // Mindfulness + Zen — added with the meditation feature 2026-06-09
  { text: "You don't have to perfect your day. You just have to begin it.", author: "Henry Shukman" },
  { text: "The mind is everything. What you think you become.", author: "Buddha" },
  { text: "Wherever you are, be there totally.", author: "Eckhart Tolle" },
  { text: "Each morning we are born again. What we do today is what matters most.", author: "Buddha" },
  { text: "Feelings come and go like clouds in a windy sky. Conscious breathing is my anchor.", author: "Thich Nhat Hanh" },
  { text: "The present moment is the only moment available to us, and it is the door to all moments.", author: "Thich Nhat Hanh" },
  { text: "Sit. Notice what's here. That's the whole practice.", author: "Henry Shukman" },
  { text: "Don't try to fix the silence with words. Let the silence settle the words.", author: "Zen saying" },
  { text: "Smile, breathe, and go slowly.", author: "Thich Nhat Hanh" },
  { text: "Drop into stillness, even for a breath. That breath changes everything.", author: "Henry Shukman" },
  { text: "Peace comes from within. Do not seek it without.", author: "Buddha" },
  { text: "The quieter you become, the more you can hear.", author: "Ram Dass" },
  { text: "In the midst of movement and chaos, keep stillness inside of you.", author: "Deepak Chopra" },
  { text: "Mindfulness isn't difficult. We just need to remember to do it.", author: "Sharon Salzberg" },
  { text: "Breathing in, I calm body and mind. Breathing out, I smile.", author: "Thich Nhat Hanh" },
];

/** Quote for a given YYYY-MM-DD, deterministic. */
export function quoteForDate(date: string): { text: string; author: string } {
  // Day-of-epoch makes a stable, monotonically increasing index so successive
  // days rotate quotes rather than colliding by date hash.
  const days = Math.floor(new Date(date + 'T12:00:00Z').getTime() / 86400000);
  return QUOTES[((days % QUOTES.length) + QUOTES.length) % QUOTES.length];
}

export function todayDate(): string {
  // Local-date in the user's TZ on the server side. The dashboard wraps this
  // so the per-user TZ from CF headers is respected if needed.
  return new Date().toISOString().slice(0, 10);
}
