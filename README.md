# GDSR — Geometry Dash Song Ratings

A website for rating Geometry Dash song replacements (mashups, covers, remixes and originals), organised by level and song ID. Backed by Supabase (Lovable Cloud).

## Features

- **The List**: every song ranked from 0 to 100 (two decimals), with type filters, sorting, and "Play all".
- **Levels**: details for each level, plus only the songs on its song ID, ranked, with a search inside the level.
- **Song pages**: YouTube embed, audio playback, score breakdown, voting (one vote per account per song), and a favourite-parts graph (X axis = song time, Y axis = number of players).
- **Accounts**: sign up, sign in, password reset, profile, my votes, my requests.
- **Requests**: users submit levels and songs (with audio upload). Admins approve or reject them with a note.
- **Music player**: persistent bottom player with queue, shuffle, repeat, seek, volume and media keys.
- **Playlists**: saved to your account (or to this browser when signed out). Reorder, make public, export as `.gdsr.json` (a list of song IDs), and import from a file or a pasted list of IDs.
- **Admin panel**: overview and data health, request review, full add/edit/delete for levels, songs, song IDs, votes, favourite parts and playlists, CSV import and export, user roles and activity, and an audio file manager.

## Scoring

- **Originals, covers and remixes:** the average of all votes. If a song has no votes yet, the admin-set `rating` is used.
- **Mashups:** `(Song A + Song B + Mashing quality) ÷ 3`. Votes on a mashup rate its mashing quality; if there are none, the admin-set `mashing_quality` is used.

## Setup (once)

1. Run `supabase/migration.sql` on the database. In Lovable you can paste it into the chat and ask Lovable to run it as a migration. The migration:
   - lets visitors read levels, songs and song IDs,
   - adds row-level security so users can only change their own votes, favourites, requests and playlists, while admins can change everything,
   - adds the `song_vote_stats` and `favourite_counts` views,
   - adds the `playlists` table,
   - creates the public `audio` storage bucket, where only admins can upload freely and users can upload only into `requests/<their id>/`.
2. Make yourself an admin by adding a row to `user_roles`: your user ID with role `admin`.
3. In Supabase Auth URL settings, add the deployed site URL so confirmation and reset emails redirect back to it.

## Files

- `index.html`: page shell
- `styles.css`: styles (dark green theme, responsive)
- `app.js`: the app. Connection settings are in `CONFIG` at the top.
- `supabase/migration.sql`: the database setup described above

## Deploying

It's a static site, so there is no build step. On Cloudflare Pages, connect this repo with framework preset **None**, leave the build command empty, and set the output directory to `/`.
