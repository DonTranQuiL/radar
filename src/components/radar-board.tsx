import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Crosshair, Pin, Search } from "lucide-react";
import { NlMap, type GemeenteFeature } from "@/components/nl-map";
import {
  DATASETS,
  loadBornAbroad,
  loadBuurten,
  loadDetail,
  loadLocalDetail,
  loadLocalTotals,
  loadMeta,
  loadOverview,
  loadPlaceLeaders,
  loadPlacePeople,
  type DatasetId,
} from "@/lib/cbs";
import { partyFill, partyShort } from "@/lib/parties";

type Area = { code: string; value: number | null };
type VoteRow = { party: string; votes: number; share: number };
type VotePlace = { name: string; winner: string; share: number; top: VoteRow[] };
type Layer = "crimes" | "nuisance" | "votes" | "born";
type People = {
  population: number | null;
  bornAbroad: number | null;
  groups: { label: string; value: number | null }[];
};
type Category = { code: string; label: string; value: number | null };
type Leader = { code: string; label: string; value: number };
type Period = { key: string; title: string };
type PinScan = {
  code: string;
  name: string;
  dataset: DatasetId;
  period: string;
  total: number | null;
};

const PARKSTAD = ["Heerlen", "Kerkrade", "Landgraaf", "Brunssum", "Simpelveld", "Voerendaal", "Beekdaelen"];
const STORE = "radar.pins.v1";
const CACHE = "radar.overview.v1";

function loadPins(): PinScan[] {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PinScan[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function bboxOf(feature: GemeenteFeature): [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const polys =
    feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const polygon of polys) {
    for (const point of polygon[0] ?? []) {
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxY = Math.max(maxY, point[1]);
    }
  }
  return [minX - 0.03, minY - 0.03, maxX + 0.03, maxY + 0.03];
}

function shortLabel(label: string) {
  return label.replace(/^\d+(\.\d+)*\s*/, "");
}

export function RadarBoard() {
  const [features, setFeatures] = useState<GemeenteFeature[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [period, setPeriod] = useState("");
  const [dataset, setDataset] = useState<DatasetId>("crimes");
  const [layer, setLayer] = useState<Layer>("crimes");
  const [areas, setAreas] = useState<Area[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Acquiring signal");
  const [error, setError] = useState("");
  const [pins, setPins] = useState<PinScan[]>([]);
  const [booting, setBooting] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [votes, setVotes] = useState<Record<string, VotePlace>>({});
  const [born, setBorn] = useState<Area[]>([]);
  const [people, setPeople] = useState<People | null>(null);
  const [localOn, setLocalOn] = useState(false);
  const [localFeatures, setLocalFeatures] = useState<GemeenteFeature[]>([]);
  const [localValues, setLocalValues] = useState<Area[]>([]);
  const [pickedLocal, setPickedLocal] = useState<string | null>(null);
  const [localCategories, setLocalCategories] = useState<Category[]>([]);
  const [localDetailState, setLocalDetailState] = useState<"idle" | "loading" | "ready">("idle");
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const hoodListRef = useRef<HTMLUListElement>(null);

  const byCode = useMemo(() => new Map(features.map((feature) => [feature.properties.code, feature.properties.name])), [features]);
  const values = useMemo(() => new Map(areas.map((area) => [area.code, area.value])), [areas]);
  const bornValues = useMemo(() => new Map(born.map((area) => [area.code, area.value])), [born]);
  const winners = useMemo(
    () => new Map(Object.entries(votes).map(([code, row]) => [code, row.winner])),
    [votes],
  );
  const localValueMap = useMemo(() => new Map(localValues.map((area) => [area.code, area.value])), [localValues]);

  useEffect(() => {
    setPins(loadPins());
    try {
      const raw = localStorage.getItem(CACHE);
      if (raw) {
        const saved = JSON.parse(raw) as { dataset: DatasetId; period: string; areas: Area[] };
        if (saved.period && Array.isArray(saved.areas)) {
          setDataset(saved.dataset);
          setPeriod(saved.period);
          setAreas(saved.areas);
          setStatus("Saved scan");
          setBooting(false);
        }
      }
    } catch {
      // ignore a broken cache
    }
    void fetch("/gemeenten.json")
      .then((response) => response.json())
      .then((payload: { features: GemeenteFeature[] }) => setFeatures(payload.features))
      .catch(() => setError("Municipality map failed to load."));
    void fetch("/votes.json")
      .then((response) => response.json())
      .then((payload: { byCode: Record<string, VotePlace> }) => setVotes(payload.byCode))
      .catch(() => setError("Election file failed to load."));
    void loadMeta()
      .then((meta) => {
        setPeriods(meta.periods);
        setPeriod(meta.latest.key);
        setError("");
      })
      .catch((cause: unknown) => {
        setBooting(false);
        setStatus("Feed unreachable");
        setError(cause instanceof Error ? cause.message : "Feed unavailable.");
      });
  }, [attempt]);

  useEffect(() => {
    if (!period) return;
    let cancelled = false;
    setStatus("Reading the national grid");
    setError("");
    void loadOverview(dataset, period)
      .then((result) => {
        if (cancelled) return;
        setAreas(result);
        setStatus("Live");
        setBooting(false);
        localStorage.setItem(CACHE, JSON.stringify({ dataset, period, areas: result }));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setBooting(false);
        setStatus("Offline");
        setError(cause instanceof Error ? cause.message : "Feed unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, period]);

  useEffect(() => {
    if (!selected || !period) return;
    let cancelled = false;
    void loadDetail(dataset, period, selected)
      .then((result) => {
        if (!cancelled) setCategories(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Detail unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, period, selected]);

  useEffect(() => {
    if (layer !== "born" || born.length > 0) return;
    let cancelled = false;
    void loadBornAbroad()
      .then((rows) => {
        if (!cancelled) setBorn(rows);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Population table unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [layer, born.length]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setPeople(null);
    void loadPlacePeople(selected)
      .then((result) => {
        if (!cancelled) setPeople(result);
      })
      .catch(() => {
        if (!cancelled) setPeople(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    setLocalOn(false);
    setPickedLocal(null);
    setLocalFeatures([]);
    setLocalValues([]);
    setLocalCategories([]);
    setLocalDetailState("idle");
  }, [selected]);

  useEffect(() => {
    if (!pickedLocal || !hoodListRef.current) return;
    hoodListRef.current.querySelector(`[data-code="${pickedLocal}"]`)?.scrollIntoView({ block: "nearest" });
  }, [pickedLocal, localFeatures]);

  useEffect(() => {
    if (!localOn || !pickedLocal || !period) {
      setLocalCategories([]);
      setLocalDetailState("idle");
      return;
    }
    let cancelled = false;
    setLocalDetailState("loading");
    void loadLocalDetail(dataset, period, pickedLocal)
      .then((rows) => {
        if (cancelled) return;
        setLocalCategories(rows);
        setLocalDetailState("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLocalCategories([]);
        setLocalDetailState("ready");
        setError(cause instanceof Error ? cause.message : "Neighbourhood detail unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [localOn, pickedLocal, period, dataset]);

  useEffect(() => {
    if (!localOn || !selected) return;
    const feature = features.find((item) => item.properties.code === selected);
    if (!feature) return;
    let cancelled = false;
    void loadBuurten(selected, bboxOf(feature))
      .then((shapes) => {
        if (!cancelled) setLocalFeatures(shapes);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Neighbourhood map unavailable.");
      });
    if (period) {
      void loadLocalTotals(dataset, period, selected)
        .then((totals) => {
          if (!cancelled) setLocalValues(totals);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : "Neighbourhood counts unavailable.");
        });
    }
    return () => {
      cancelled = true;
    };
  }, [localOn, selected, period, dataset, features]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return features
      .filter((feature) => feature.properties.name.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [features, query]);

  const selectedName = selected ? (byCode.get(selected) ?? selected) : "Select a municipality";
  const pickedHood = localFeatures.find((feature) => feature.properties.code === pickedLocal);
  const hoodTotal = pickedLocal ? (localValueMap.get(pickedLocal) ?? null) : null;
  const showingHood = localOn && pickedHood != null;
  const total = categories.find((row) => row.label.toLowerCase().startsWith("totaal"));
  const activeCategories = showingHood ? localCategories : categories;
  const activeTotal = showingHood
    ? (activeCategories.find((row) => row.label.toLowerCase().startsWith("totaal"))?.value ?? hoodTotal)
    : total?.value;
  const breakdown = activeCategories
    .filter((row) => row.value != null && !row.label.toLowerCase().startsWith("totaal"))
    .slice(0, 10);
  const ranked = [...areas]
    .filter((area) => area.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 5);
  const lowest = [...areas]
    .filter((area) => area.value != null && area.value > 0)
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
    .slice(0, 5);
  const leaderKey = [...new Set([...ranked, ...lowest].map((area) => area.code))].sort().join(",");

  useEffect(() => {
    if (!period || !leaderKey) return;
    let cancelled = false;
    void loadPlaceLeaders(dataset, period, leaderKey.split(","))
      .then((rows) => {
        if (!cancelled) setLeaders(rows);
      })
      .catch(() => {
        if (!cancelled) setLeaders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, period, leaderKey]);

  const topAct = showingHood && localDetailState !== "ready" ? undefined : breakdown[0];

  function focusName(name: string) {
    const feature = features.find((item) => item.properties.name === name);
    if (!feature) return;
    setSelected(feature.properties.code);
    setQuery("");
  }

  function pinCurrent() {
    if (!selected || !period) return;
    const next: PinScan = {
      code: selected,
      name: selectedName,
      dataset,
      period,
      total: total?.value ?? values.get(selected) ?? null,
    };
    const stored = [next, ...pins.filter((pin) => !(pin.code === next.code && pin.dataset === next.dataset && pin.period === next.period))].slice(0, 8);
    setPins(stored);
    localStorage.setItem(STORE, JSON.stringify(stored));
  }

  return (
    <main className="min-h-screen bg-bg text-fg">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
        <div>
          <p className="font-mono text-xs tracking-widest text-primary">OPEN SIGNAL / POLITIE CBS</p>
          <h1 className="mt-1 text-4xl text-fg">RADAR</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Crimes, nuisance, the 2025 vote, and who is registered as living there. Place totals, not who did it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border bg-surface px-3 py-2 text-xs text-primary">{status}</span>
          <button
            type="button"
            onClick={() => {
              setStatus("Acquiring signal");
              setError("");
              setBooting(true);
              setAttempt((value) => value + 1);
            }}
            className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
          >
            Retry
          </button>
          <label className="sr-only" htmlFor="period">
            Month
          </label>
          <select
            id="period"
            className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-fg"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            {periods.map((item) => (
              <option key={item.key} value={item.key}>
                {item.title}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="grid lg:grid-cols-[18rem_minmax(0,1fr)_22rem]">
        <aside className="border-b border-border p-4 lg:border-r lg:border-b-0">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["crimes", "Crimes"],
                ["nuisance", "Nuisance"],
                ["votes", "Vote 2025"],
                ["born", "Born abroad"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setLayer(id);
                  if (id === "crimes" || id === "nuisance") setDataset(id);
                  if (id === "votes" || id === "born") setLocalOn(false);
                }}
                className={`min-h-11 rounded-md border px-3 text-sm ${
                  layer === id ? "border-primary bg-surface-2 text-primary" : "border-border bg-surface text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Municipality"
              className="min-h-11 w-full rounded-md border border-border bg-surface pr-3 pl-10 text-sm text-fg outline-none focus:border-primary"
            />
            {matches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface">
                {matches.map((feature) => (
                  <li key={feature.properties.code}>
                    <button
                      type="button"
                      className="min-h-11 w-full px-3 text-left text-sm hover:bg-surface-2"
                      onClick={() => focusName(feature.properties.name)}
                    >
                      {feature.properties.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <h2 className="mt-6 text-sm tracking-wide text-muted">PARKSTAD</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {PARKSTAD.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => focusName(name)}
                className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm hover:border-primary"
              >
                {name}
              </button>
            ))}
          </div>
          <h2 className="mt-6 text-sm tracking-wide text-muted">HIGHEST THIS MONTH</h2>
          <ol className="mt-2 space-y-1">
            {ranked.map((area) => {
              const lead = leaders.find((row) => row.code === area.code);
              return (
                <li key={area.code}>
                  <button
                    type="button"
                    onClick={() => setSelected(area.code)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-surface"
                  >
                    <span>
                      <span className="block">{byCode.get(area.code) ?? area.code}</span>
                      {lead && <span className="block text-xs text-muted">{shortLabel(lead.label)}</span>}
                    </span>
                    <span className="text-primary">{area.value}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <h2 className="mt-6 text-sm tracking-wide text-muted">LOWEST THIS MONTH</h2>
          <p className="mt-1 text-xs text-muted">Smallest published counts. Not a rate per resident, so small places sit here.</p>
          <ol className="mt-2 space-y-1">
            {lowest.map((area) => {
              const lead = leaders.find((row) => row.code === area.code);
              return (
                <li key={area.code}>
                  <button
                    type="button"
                    onClick={() => setSelected(area.code)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-surface"
                  >
                    <span>
                      <span className="block">{byCode.get(area.code) ?? area.code}</span>
                      {lead && <span className="block text-xs text-muted">{shortLabel(lead.label)}</span>}
                    </span>
                    <span className="text-primary">{area.value}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          {pins.length > 0 && (
            <>
              <h2 className="mt-6 text-sm tracking-wide text-muted">PINNED SCANS</h2>
              <ul className="mt-2 space-y-1">
                {pins.map((pin) => (
                  <li key={`${pin.code}-${pin.dataset}-${pin.period}`}>
                    <button
                      type="button"
                      className="min-h-11 w-full rounded-md px-2 text-left text-sm hover:bg-surface"
                      onClick={() => {
                        setDataset(pin.dataset);
                        setPeriod(pin.period);
                        setSelected(pin.code);
                      }}
                    >
                      {pin.name}
                      <span className="block text-xs text-muted">
                        {pin.period} · {pin.total ?? "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <section className="relative min-h-[28rem] border-b border-border lg:min-h-screen lg:border-b-0">
          {features.length === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg">
              <div className="relative size-24 rounded-full border border-primary">
                <div className="radar-sweep absolute inset-2 origin-center rounded-full border-t border-primary" />
                <Crosshair className="absolute inset-0 m-auto size-6 text-primary" />
              </div>
            </div>
          )}
          <NlMap
            features={localOn ? localFeatures : features}
            values={localOn ? localValueMap : layer === "born" ? bornValues : values}
            parties={layer === "votes" && !localOn ? winners : undefined}
            selected={localOn ? pickedLocal : selected}
            tight={localOn}
            onSelect={localOn ? setPickedLocal : setSelected}
          />
          <div className="absolute top-3 left-3 flex flex-wrap gap-2">
            {selected && (layer === "crimes" || layer === "nuisance") && (
              <button
                type="button"
                onClick={() => setLocalOn((on) => !on)}
                className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-fg"
              >
                {localOn ? "Back to Netherlands" : "Neighbourhoods"}
              </button>
            )}
          </div>
          <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap items-center gap-2 text-xs text-muted">
            {layer === "votes" && !localOn ? (
              <span>Colour is the largest party, Tweede Kamer 29 Oct 2025. Not a buurt result.</span>
            ) : layer === "born" && !localOn ? (
              <span>Percent of residents born outside the Netherlands, 1 Jan 2026.</span>
            ) : (
              <>
                <span className="size-3 bg-heat-0" />
                <span className="size-3 bg-heat-1" />
                <span className="size-3 bg-heat-2" />
                <span className="size-3 bg-heat-3" />
                <span className="size-3 bg-heat-4" />
                <span className="ml-1">{localOn ? "neighbourhood count" : "low to high count"}</span>
              </>
            )}
          </div>
        </section>

        <aside className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs tracking-widest text-muted">
                {showingHood ? "NEIGHBOURHOOD" : DATASETS[dataset].label}
              </p>
              <h2 className="text-3xl text-fg">{showingHood ? pickedHood.properties.name : selectedName}</h2>
              <p className="mt-1 text-4xl text-primary">
                {showingHood ? (activeTotal ?? "—") : (total?.value ?? (selected ? (values.get(selected) ?? "—") : "—"))}
              </p>
              <p className="text-xs text-muted">
                {showingHood ? `in ${selectedName} · registered this month` : "registered this month"}
              </p>
              {topAct && (
                <p className="mt-3 text-sm text-fg">
                  <span className="block text-xs tracking-widest text-muted">MOST REGISTERED HERE</span>
                  {shortLabel(topAct.label)}
                  <span className="text-primary"> {topAct.value}</span>
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={pinCurrent}
              disabled={!selected}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-fg disabled:opacity-40"
            >
              <Pin className="size-4" />
              Pin
            </button>
          </div>
          {error && <p className="mt-4 rounded-md border border-alert bg-surface px-3 py-2 text-sm text-alert">{error}</p>}
          {selected && votes[selected] && (
            <div className="mt-4">
              <p className="text-xs tracking-widest text-muted">LARGEST PARTY, TK 2025{showingHood ? ` · ${selectedName}` : ""}</p>
              <p className="mt-1 text-lg text-fg">
                <span className="mr-2 inline-block size-3 align-middle" style={{ background: partyFill(votes[selected].winner) }} />
                {partyShort(votes[selected].winner)}
                <span className="text-muted"> {votes[selected].share}%</span>
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {votes[selected].top.map((row) => (
                  <li key={row.party} className="flex justify-between gap-3">
                    <span>{partyShort(row.party)}</span>
                    <span className="text-muted">{row.share}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {selected && (
            <div className="mt-4 text-sm">
              <p className="text-xs tracking-widest text-muted">REGISTERED RESIDENTS, 1 JAN 2026{showingHood ? ` · ${selectedName}` : ""}</p>
              {people ? (
                <ul className="mt-2 space-y-1">
                  <li className="flex justify-between gap-3">
                    <span>Population</span>
                    <span>{people.population ?? "—"}</span>
                  </li>
                  <li className="flex justify-between gap-3">
                    <span>Born abroad</span>
                    <span>
                      {people.bornAbroad ?? "—"}
                      {people.population && people.bornAbroad != null
                        ? ` (${Math.round((1000 * people.bornAbroad) / people.population) / 10}%)`
                        : ""}
                    </span>
                  </li>
                  {people.groups.map((group) => (
                    <li key={group.label} className="flex justify-between gap-3">
                      <span>{group.label}</span>
                      <span>{group.value ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-muted">Population table still loading, or CBS is not answering.</p>
              )}
              <p className="mt-2 text-xs text-muted">
                Undocumented residents are not published per municipality. People in prison are published only as a
                national total, not by the town they come from. “Origin outside the Netherlands” includes people born
                here with a parent born abroad. None of this says who committed an offence.
              </p>
            </div>
          )}
          {localOn && (
            <div className="mt-4">
              <p className="text-xs tracking-widest text-muted">NEIGHBOURHOODS</p>
              <ul ref={hoodListRef} className="mt-2 max-h-64 space-y-1 overflow-auto">
                {localFeatures
                  .map((feature) => ({
                    code: feature.properties.code,
                    name: feature.properties.name,
                    value: localValueMap.get(feature.properties.code),
                  }))
                  .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
                  .map((row) => (
                    <li key={row.code}>
                      <button
                        type="button"
                        data-code={row.code}
                        onClick={() => setPickedLocal(row.code)}
                        className={`flex min-h-11 w-full items-center justify-between rounded-md px-2 text-left text-sm ${
                          row.code === pickedLocal ? "bg-surface text-fg ring-1 ring-primary" : "hover:bg-surface"
                        }`}
                      >
                        <span>{row.name}</span>
                        <span className="text-primary">{row.value ?? "—"}</span>
                      </button>
                    </li>
                  ))}
              </ul>
              {!pickedLocal && (
                <p className="mt-2 text-xs text-muted">Click a neighbourhood. The count and the bars switch to that area.</p>
              )}
            </div>
          )}
          <div className="mt-6 h-80">
            {showingHood && localDetailState === "loading" ? (
              <p className="text-sm text-muted">Reading {pickedHood.properties.name}…</p>
            ) : breakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={breakdown.map((row) => ({ name: shortLabel(row.label), value: row.value }))} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fill: "var(--color-muted)", fontSize: 11 }} />
                  <Tooltip
                    cursor={{ fill: "var(--color-surface-2)" }}
                    contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-fg)" }}
                  />
                  <Bar dataKey="value" fill="var(--color-primary)" radius={2} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted">
                {showingHood
                  ? `${pickedHood.properties.name} has no published category split this month. The count above is the neighbourhood total. Small cells are suppressed.`
                  : "Click a municipality, or jump to Parkstad, to open the category breakdown."}
              </p>
            )}
          </div>
          <p className="mt-4 text-xs text-muted">
            Source: police open data (47013NED, 47021NED, 47022NED, 47024NED), CBS population 85458NED, Kiesraad TK 2025
            (CC0). Counts, not rates. Small cells are suppressed. Not an incident log. © 2026 Don TranQuiL. MIT.
          </p>
        </aside>
      </div>
    </main>
  );
}
