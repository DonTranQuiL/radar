import { createFileRoute } from "@tanstack/react-router";
import { RadarBoard } from "@/components/radar-board";

export const Route = createFileRoute("/")({ component: RadarBoard });
