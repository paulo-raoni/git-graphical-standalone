import { describe, expect, it } from 'vitest';

import { UNKNOWN_INDEX } from '../../contracts/index';

import {
  createOpenLanes,
  firstFreeLane,
  FREE_LANE,
  INITIAL_LANE_CAPACITY,
  laneAwaitsUnloaded,
  laneTableByteLength,
  nextLaneCapacity,
  occupyLane,
} from './open-lanes';

describe('nextLaneCapacity', () => {
  it('leaves a capacity that already fits alone', () => {
    expect(nextLaneCapacity(8, 8)).toBe(8);
    expect(nextLaneCapacity(8, 1)).toBe(8);
  });

  it('grows by five quarters, rounded up', () => {
    expect(nextLaneCapacity(8, 9)).toBe(10);
    expect(nextLaneCapacity(4, 5)).toBe(5);
  });

  it('applies the factor repeatedly until the requirement fits', () => {
    expect(nextLaneCapacity(8, 20)).toBe(22);
  });

  it('starts from one when there is no capacity at all', () => {
    expect(nextLaneCapacity(0, 3)).toBe(3);
  });
});

describe('a fresh lane table', () => {
  it('opens no lane and leaves every slot free', () => {
    const lanes = createOpenLanes();
    expect(lanes.limit).toBe(0);
    expect(lanes.target.length).toBe(INITIAL_LANE_CAPACITY);
    expect([...lanes.target]).toEqual(new Array<number>(INITIAL_LANE_CAPACITY).fill(FREE_LANE));
  });

  it('costs eight bytes a lane, which is what a page carries to the next', () => {
    expect(laneTableByteLength(createOpenLanes())).toBe(INITIAL_LANE_CAPACITY * 8);
  });
});

describe('the table growing', () => {
  it('does not reallocate for a lane it already has room for', () => {
    const lanes = createOpenLanes();
    const target = lanes.target;
    const slot = lanes.slot;
    occupyLane(lanes, INITIAL_LANE_CAPACITY - 1, 5, 0);
    expect(lanes.target).toBe(target);
    expect(lanes.slot).toBe(slot);
  });

  it('grows geometrically and leaves the lanes it adds free', () => {
    const lanes = createOpenLanes();
    occupyLane(lanes, 0, 5, 0);
    occupyLane(lanes, INITIAL_LANE_CAPACITY, 6, 1);
    expect(lanes.target.length).toBe(nextLaneCapacity(INITIAL_LANE_CAPACITY, 9));
    expect(lanes.target[0]).toBe(5);
    expect(lanes.target[INITIAL_LANE_CAPACITY]).toBe(6);
    expect(lanes.target[INITIAL_LANE_CAPACITY - 1]).toBe(FREE_LANE);
    // The lane the growth added past the one being filled. A zeroed slot would
    // read as a lane waiting for row zero, which is not free and not open.
    expect(lanes.target[INITIAL_LANE_CAPACITY + 1]).toBe(FREE_LANE);
    expect(lanes.slot[0]).toBe(0);
    expect(lanes.slot[INITIAL_LANE_CAPACITY]).toBe(1);
    expect(lanes.slot.length).toBe(lanes.target.length);
  });
});

describe('firstFreeLane', () => {
  it('is lane zero when nothing is open', () => {
    expect(firstFreeLane(createOpenLanes())).toBe(0);
  });

  it('reuses a lane a line has left rather than opening a wider graph', () => {
    const lanes = createOpenLanes();
    occupyLane(lanes, 0, 9, 0);
    occupyLane(lanes, 1, 9, 1);
    lanes.target[0] = FREE_LANE;
    expect(firstFreeLane(lanes)).toBe(0);
  });

  it('opens the next lane when every open one is taken', () => {
    const lanes = createOpenLanes();
    occupyLane(lanes, 0, 9, 0);
    occupyLane(lanes, 1, 9, 1);
    expect(firstFreeLane(lanes)).toBe(2);
  });
});

describe('occupyLane', () => {
  it('records the target and the parent entry, and widens the table', () => {
    const lanes = createOpenLanes();
    occupyLane(lanes, 3, UNKNOWN_INDEX, 12);
    expect(lanes.target[3]).toBe(UNKNOWN_INDEX);
    expect(lanes.slot[3]).toBe(12);
    expect(lanes.limit).toBe(4);
    expect(laneAwaitsUnloaded(lanes, 3)).toBe(true);
    expect(laneAwaitsUnloaded(lanes, 0)).toBe(false);
  });

  it('does not narrow the table when it fills a lane inside it', () => {
    const lanes = createOpenLanes();
    occupyLane(lanes, 3, 9, 0);
    occupyLane(lanes, 1, 9, 1);
    expect(lanes.limit).toBe(4);
    expect(lanes.target[2]).toBe(FREE_LANE);
  });

  it('makes room for a lane past the table it was given', () => {
    const lanes = createOpenLanes();
    occupyLane(lanes, INITIAL_LANE_CAPACITY + 2, 9, 0);
    expect(lanes.target[INITIAL_LANE_CAPACITY + 2]).toBe(9);
    expect(lanes.limit).toBe(INITIAL_LANE_CAPACITY + 3);
  });
});
