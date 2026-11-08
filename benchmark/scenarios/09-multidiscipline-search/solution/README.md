# Notes

A tiny notes app. `npm start` serves it on http://localhost:3000 (PORT to change). Notes are kept in
memory, seeded with a few examples.

## API

- `GET /api/notes` — all notes
- `POST /api/notes` — `{ "title", "body" }` creates a note

## Search

`GET /api/notes?q=text` returns notes whose title or body contains the text (any case). The search box filters as you type.
