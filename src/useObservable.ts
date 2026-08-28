/**
 * Binds one of openDAW's ObservableValues to React state.
 *
 * The engine publishes its position, playing state and so on as
 * ObservableValue<T> — `catchupAndSubscribe` fires immediately with the
 * current value and then on every change, and returns a Subscription to
 * terminate. That's a clean fit for an effect, but writing it out at every
 * call site is where subscriptions get leaked.
 */
import { useEffect, useState } from "react";
import type { ObservableValue } from "@opendaw/lib-std";

export function useObservable<T>(value: ObservableValue<T> | null, fallback: T): T {
  const [current, setCurrent] = useState<T>(() => value?.getValue() ?? fallback);

  useEffect(() => {
    if (!value) {
      setCurrent(fallback);
      return;
    }
    const subscription = value.catchupAndSubscribe((owner) => setCurrent(owner.getValue()));
    return () => subscription.terminate();
    // fallback is only used before a value exists; re-subscribing when it
    // changes identity would tear down a live subscription for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return current;
}

/**
 * The transport position, polled rather than subscribed.
 *
 * Position changes every audio block — subscribing would re-render React
 * hundreds of times a second for a clock that only needs to look right. An
 * animation frame is the rate the screen actually updates at.
 */
export function useAnimationValue<T>(read: () => T, active: boolean, fallback: T): T {
  const [current, setCurrent] = useState<T>(fallback);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const tick = () => {
      setCurrent(read());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return current;
}
