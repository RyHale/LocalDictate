import { describe, expect, test } from "bun:test";

import {
  DEBUG_MODEL_UNLOAD_TIMEOUT_VALUE,
  MODEL_UNLOAD_TIMEOUT_VALUES,
} from "../src/components/settings/ModelUnloadTimeout";
import { RECORDING_RETENTION_PERIOD_VALUES } from "../src/components/settings/RecordingRetentionPeriod";

describe("settings enum contracts", () => {
  test("exposes every canonical model unload timeout value", () => {
    expect([
      ...MODEL_UNLOAD_TIMEOUT_VALUES,
      DEBUG_MODEL_UNLOAD_TIMEOUT_VALUE,
    ]).toEqual([
      "never",
      "immediately",
      "min_2",
      "min_5",
      "min_10",
      "min_15",
      "hour_1",
      "sec_15",
    ]);
  });

  test("exposes every canonical recording retention value", () => {
    expect(RECORDING_RETENTION_PERIOD_VALUES).toEqual([
      "never",
      "preserve_limit",
      "days_3",
      "weeks_2",
      "months_3",
    ]);
  });
});
