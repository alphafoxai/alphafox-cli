import assert from "node:assert/strict";
import test from "node:test";

import {
  applySweepCoordinate,
  DEFAULT_SWEEP_CONCURRENCY,
  FREE_MAX_SWEEP_COMBINATIONS,
  FREE_MAX_SWEEP_PARAMS,
  MAX_SWEEP_CONCURRENCY,
  planSweep,
  planSweepFastRefinement,
  PRO_MAX_SWEEP_COMBINATIONS,
  resolveMaxSweepCombinations,
  resolveMaxSweepParams,
  resolveSweepConcurrency,
  SWEEP_SERIAL_CONCURRENCY,
  type SweepAxisInput,
} from "../src/engine-backtest/sweep-kernel";

function rangeAxis(index: number, current = 10): SweepAxisInput {
  return {
    path: ["strategy", `param${index}`],
    current,
    isInteger: true,
    min: 0,
    max: 20,
    window: { min: 0, max: 20, step: 1 },
  };
}

test("planSweep builds the cartesian product of explicit axis values", () => {
  const plan = planSweep({
    axes: [
      {
        path: ["common", "execution", "leverage"],
        current: 10,
        isInteger: true,
        values: [5, 10],
      },
      {
        path: ["strategy", "notionalCoefficient"],
        current: 0.6,
        isInteger: false,
        values: [0.6, 0.8],
      },
    ],
    subscriptionTier: "pro",
  });

  assert.equal(plan.requestedCombinationCount, 4);
  assert.equal(plan.sampled, false);
  assert.deepEqual(
    plan.coordinates.map((coordinate) => [...coordinate.values]),
    [
      [5, 0.6],
      [5, 0.8],
      [10, 0.6],
      [10, 0.8],
    ]
  );
});

test("planSweep expands a min/max/step window and keeps the current value", () => {
  const plan = planSweep({
    axes: [
      {
        path: ["strategy", "period"],
        current: 10,
        isInteger: true,
        min: 0,
        max: 20,
        window: { min: 8, max: 12, step: 2 },
      },
    ],
  });

  assert.deepEqual(plan.axes[0]?.values, [8, 10, 12]);
  assert.deepEqual(plan.coordinates, [
    { values: [8] },
    { values: [10] },
    { values: [12] },
  ]);
});

test("planSweep downsamples Free cartesian searches to the combination cap", () => {
  const plan = planSweep({
    axes: [0, 1, 2].map((index) => rangeAxis(index)),
    searchMode: "standard",
    subscriptionTier: "free",
  });

  assert.equal(plan.requestedCombinationCount, 9_261);
  assert.ok(plan.coordinates.length <= FREE_MAX_SWEEP_COMBINATIONS);
  assert.equal(plan.sampled, true);
  assert.ok(
    plan.coordinates.some((coordinate) =>
      coordinate.values.every((value) => value === 10)
    )
  );
});

test("planSweep keeps a Pro 7^3 neighborhood under the 2000-combination cap", () => {
  const plan = planSweep({
    axes: [0, 1, 2].map((index) => ({
      ...rangeAxis(index),
      window: { min: 7, max: 13, step: 1 },
    })),
    searchMode: "standard",
    subscriptionTier: "pro",
  });

  assert.equal(plan.requestedCombinationCount, 343);
  assert.equal(plan.coordinates.length, 343);
  assert.equal(plan.sampled, false);
});

test("planSweep terminates when a tiny cap requires one-point axes", () => {
  const plan = planSweep({
    axes: [0, 1, 2].map((index) => rangeAxis(index)),
    searchMode: "standard",
    subscriptionTier: "pro",
    maxCombinations: 1,
  });

  assert.equal(plan.coordinates.length, 1);
  assert.deepEqual(plan.coordinates[0], { values: [10, 10, 10] });
  assert.equal(plan.sampled, true);
});

test("fast joint search uses a coarse 3-point grid and keeps current values", () => {
  const plan = planSweep({
    axes: [0, 1, 2].map((index) => rangeAxis(index)),
    searchMode: "fast",
    subscriptionTier: "free",
  });

  assert.equal(plan.requestedCombinationCount, 9_261);
  assert.deepEqual(
    plan.axes.map((axis) => axis.values.length),
    [3, 3, 3]
  );
  assert.equal(plan.coordinates.length, 27);
  assert.ok(
    plan.coordinates.some((coordinate) =>
      coordinate.values.every((value) => value === 10)
    )
  );
});

test("fast joint search still obeys the Free combination cap", () => {
  const plan = planSweep({
    axes: [0, 1, 2, 3, 4].map((index) => rangeAxis(index)),
    searchMode: "fast",
    subscriptionTier: "free",
  });

  assert.ok(plan.coordinates.length <= FREE_MAX_SWEEP_COMBINATIONS);
  assert.ok(
    plan.coordinates.some((coordinate) =>
      coordinate.values.every((value) => value === 10)
    )
  );
});

test("fast joint search obeys an explicit one-combination cap", () => {
  const plan = planSweep({
    axes: [0, 1, 2].map((index) => rangeAxis(index)),
    searchMode: "fast",
    subscriptionTier: "pro",
    maxCombinations: 1,
  });

  assert.equal(plan.coordinates.length, 1);
  assert.deepEqual(plan.coordinates[0], { values: [10, 10, 10] });
});

test("fast refinement drops coordinates already evaluated in the coarse grid", () => {
  const axes = [0, 1, 2].map((index) => rangeAxis(index));
  const coarsePlan = planSweep({
    axes,
    searchMode: "fast",
    subscriptionTier: "free",
  });
  const standardPlan = planSweep({
    axes,
    searchMode: "standard",
    subscriptionTier: "free",
  });
  const refinement = planSweepFastRefinement({
    coarsePlan,
    standardPlan,
    center: { values: [10, 10, 10] },
  });
  const coarseKeys = new Set(
    coarsePlan.coordinates.map((coordinate) => coordinate.values.join("\u0000"))
  );

  assert.ok(refinement.length > 0);
  assert.ok(refinement.length <= 26);
  assert.ok(
    refinement.every(
      (coordinate) => !coarseKeys.has(coordinate.values.join("\u0000"))
    )
  );
});

test("fast mode leaves a single explicit axis at full resolution", () => {
  const plan = planSweep({
    axes: [rangeAxis(0)],
    searchMode: "fast",
    subscriptionTier: "free",
  });

  assert.equal(plan.coordinates.length, 21);
  assert.equal(plan.sampled, false);
});

test("Free, Pro, and Pro Max share the same axis, combination, and concurrency rules", () => {
  assert.equal(resolveMaxSweepParams("free"), FREE_MAX_SWEEP_PARAMS);
  assert.equal(resolveMaxSweepParams("pro"), null);
  assert.equal(resolveMaxSweepParams("pro_max"), null);
  assert.equal(
    resolveMaxSweepCombinations("free"),
    FREE_MAX_SWEEP_COMBINATIONS
  );
  assert.equal(resolveMaxSweepCombinations("pro"), PRO_MAX_SWEEP_COMBINATIONS);
  assert.equal(
    resolveMaxSweepCombinations("pro_max"),
    PRO_MAX_SWEEP_COMBINATIONS
  );
  assert.equal(
    resolveSweepConcurrency({ subscriptionTier: "free", requested: 4 }),
    SWEEP_SERIAL_CONCURRENCY
  );
  assert.equal(
    resolveSweepConcurrency({ subscriptionTier: undefined, requested: 4 }),
    SWEEP_SERIAL_CONCURRENCY
  );
  assert.equal(
    resolveSweepConcurrency({
      subscriptionTier: "pro",
      requested: DEFAULT_SWEEP_CONCURRENCY,
    }),
    DEFAULT_SWEEP_CONCURRENCY
  );
  assert.equal(
    resolveSweepConcurrency({
      subscriptionTier: "pro_max",
      requested: MAX_SWEEP_CONCURRENCY,
    }),
    MAX_SWEEP_CONCURRENCY
  );
  assert.equal(
    resolveSweepConcurrency({ subscriptionTier: "pro", requested: 99 }),
    DEFAULT_SWEEP_CONCURRENCY
  );

  const sixAxes = [0, 1, 2, 3, 4, 5].map((index) => rangeAxis(index));
  const freePlan = planSweep({
    axes: sixAxes,
    searchMode: "standard",
    subscriptionTier: "free",
  });
  assert.equal(freePlan.axes.length, FREE_MAX_SWEEP_PARAMS);
});

test("applySweepCoordinate writes each axis value into a nested config copy", () => {
  const config = {
    common: { execution: { leverage: 10 } },
    strategy: {
      notionalCoefficient: 0.6,
      symbols: [
        { spacing: { value: 0.01 }, quantityLadder: { multiplier: 1.5 } },
      ],
    },
  };

  assert.deepEqual(
    applySweepCoordinate(
      config,
      [
        { path: ["common", "execution", "leverage"] },
        { path: ["strategy", "notionalCoefficient"] },
      ],
      { values: [5, 0.8] }
    ),
    {
      common: { execution: { leverage: 5 } },
      strategy: {
        notionalCoefficient: 0.8,
        symbols: [
          { spacing: { value: 0.01 }, quantityLadder: { multiplier: 1.5 } },
        ],
      },
    }
  );
  assert.deepEqual(
    applySweepCoordinate(
      config,
      [
        { path: ["strategy", "symbols", "0", "quantityLadder", "multiplier"] },
        { path: ["strategy", "symbols", "0", "spacing", "value"] },
      ],
      { values: [2, 0.02] }
    ),
    {
      common: { execution: { leverage: 10 } },
      strategy: {
        notionalCoefficient: 0.6,
        symbols: [
          { spacing: { value: 0.02 }, quantityLadder: { multiplier: 2 } },
        ],
      },
    }
  );
  assert.deepEqual(config.strategy.symbols[0]?.spacing.value, 0.01);
});
