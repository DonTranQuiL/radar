# RADAR

Copyright (c) 2026 Don TranQuiL. Licensed under the [MIT License](LICENSE).

RADAR is a public map of the Netherlands. It puts official counts next to each other so you can look at a municipality, and at neighbourhoods inside it. It does not say who committed an offence.

## What you can look at

| Layer | What it shows | Where it stops |
| --- | --- | --- |
| Crimes | Registered crimes this month | Municipality, and neighbourhood after you open one |
| Nuisance | Registered nuisance this month | Same |
| Vote 2025 | Largest party, Tweede Kamer 29 October 2025 | Municipality only. No neighbourhood vote exists |
| Born abroad | Share of registered residents born outside the Netherlands, 1 January 2026 | Municipality |

Open a municipality and the side panel also shows the top parties, population, and a few origin groups (including people born in the Netherlands with a parent born abroad).

On Crimes or Nuisance, **Neighbourhoods** zooms into buurten. Kerkrade includes Hopel.

## What this is not

- Not an incident log. You cannot see a single report of graffiti or a broken window.
- Not a count of undocumented residents. That is not published per municipality.
- Not a count of people in prison from that town. Prison figures are national only.
- Place totals do not identify offenders. A high count and a party colour on the same map are not a cause.

Small counts are suppressed by the police tables. Figures are counts, not rates per 1,000 residents.

## Where the numbers come from

- Police open data via CBS: tables `47013NED`, `47021NED`, `47022NED`, `47024NED`. [politieopendata.cbs.nl](https://politieopendata.cbs.nl). CC BY 4.0.
- Population by origin: CBS table `85458NED`, 1 January 2026.
- Election: Kiesraad, Tweede Kamer 29 October 2025, municipality list totals. CC0. Stored in `public/votes.json`.
- Municipality and neighbourhood shapes: PDOK CBS gebiedsindelingen.

## What updates by itself

**New crime or nuisance month.** Yes, for the tables already wired in. The month list is read live from CBS. When Statistics Netherlands adds the next month to those tables (often around the middle of the following month), the dropdown picks it up. You do not upload a new file. A brand-new table with a different id is not picked up. The code would have to name that table.

**Population year.** No. The app asks CBS for `2026JJ00` on purpose. When the 2027 population table is published, RADAR still shows 1 January 2026 until that year in the code is changed and the site is deployed again.

**Neighbourhood borders.** No. Shapes are PDOK year 2025. A later boundary set is not swapped in automatically.

**A new election in one or two years.** No. The vote layer is a file shipped with the site (`public/votes.json`), built from the Kiesraad CSV. A later Tweede Kamer election does not replace it. Someone has to download the new official CSV, rebuild that file, and deploy again.

## Run it on your computer

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:8080/`.

The browser talks to CBS and PDOK directly. If those feeds are down, the map shell still loads and the panel says the feed is unavailable.

## Put it on the public web

GitHub can store this repository. **GitHub Pages cannot run this site.** Pages only serves static files. RADAR is a small server app (TanStack Start) and its production build is set up for Vercel (`vercel.json`).

To run it in public:

1. Create an empty GitHub repository.
2. Upload this project (or push it with git). Do not upload `node_modules`.
3. On [vercel.com](https://vercel.com), import that GitHub repository and deploy.

After that, a new crime month still appears by itself, because each visitor’s browser asks CBS. A new election still needs a new `public/votes.json` and a new deploy.

## License

The application code is MIT, copyright Don TranQuiL. See [LICENSE](LICENSE).

The numbers and maps stay under the licences of their publishers (CBS, Kiesraad, PDOK). MIT does not re-license those datasets.
