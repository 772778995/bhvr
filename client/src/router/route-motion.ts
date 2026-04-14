interface RouteTransitionOptions {
  to?: string | null;
  from?: string | null;
}

export interface RouteTransitionConfig {
  name: string;
  enterY: number;
  leaveY: number;
  durationEnterMs: number;
  durationLeaveMs: number;
}

const PAPER_ROUTE_TRANSITION: RouteTransitionConfig = {
  name: "paper-route",
  enterY: 8,
  leaveY: -4,
  durationEnterMs: 180,
  durationLeaveMs: 120,
};

export function getRouteTransitionName(_options: RouteTransitionOptions = {}): string {
  return PAPER_ROUTE_TRANSITION.name;
}

export function getRouteTransition(_options: RouteTransitionOptions = {}): RouteTransitionConfig {
  return PAPER_ROUTE_TRANSITION;
}
