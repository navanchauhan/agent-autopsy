const fs = require("node:fs");
const path = require("node:path");

function sortedUnique(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value))].sort();
}

function normalizeSurface(surface) {
  if (!surface || typeof surface !== "object" || Array.isArray(surface)) {
    throw new Error("Observed surface must be an object");
  }
  for (const field of ["id", "category"]) {
    if (typeof surface[field] !== "string" || surface[field] === "") {
      throw new Error(`Observed surface ${field} must be a nonempty string`);
    }
  }
  const normalized = {
    id: surface.id,
    category: surface.category,
    models: sortedUnique(surface.models),
    modes: sortedUnique(surface.modes),
    artifacts: sortedUnique(surface.artifacts),
  };
  for (const field of ["models", "modes", "artifacts"]) {
    if (normalized[field].length === 0) {
      throw new Error(`Observed surface ${surface.id} must have ${field}`);
    }
  }
  return normalized;
}

function writeSurfaceObservations(filePath, provider, observedRelease, surfaces, options = {}) {
  if (typeof provider !== "string" || provider === "") throw new Error("Provider is required");
  if (typeof observedRelease !== "string" || observedRelease === "") {
    throw new Error("Observed release is required");
  }

  const byId = new Map();
  if (options.merge && fs.existsSync(filePath)) {
    const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (existing.provider !== provider || existing.observed_release !== observedRelease) {
      throw new Error("Cannot merge surface observations from different providers or releases");
    }
    for (const surface of existing.surfaces || []) byId.set(surface.id, normalizeSurface(surface));
  }
  for (const surface of surfaces) {
    const next = normalizeSurface(surface);
    const prior = byId.get(next.id);
    byId.set(next.id, prior ? normalizeSurface({
      id: next.id,
      category: next.category,
      models: [...prior.models, ...next.models],
      modes: [...prior.modes, ...next.modes],
      artifacts: [...prior.artifacts, ...next.artifacts],
    }) : next);
  }

  const inventory = {
    schema_version: 1,
    provider,
    observed_release: observedRelease,
    authority: "model-request",
    complete: true,
    surfaces: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(inventory, null, 2)}\n`);
  return inventory;
}

module.exports = { writeSurfaceObservations };
