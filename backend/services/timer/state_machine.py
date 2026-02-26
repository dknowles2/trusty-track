from enum import Enum


class TimerState(Enum):
    DISCONNECTED = "DISCONNECTED"
    CONNECTED = "CONNECTED"
    IDLE = "IDLE"
    ARMED = "ARMED"
    READY = "READY"
    RUNNING = "RUNNING"
    RESULTS_OVERDUE = "RESULTS_OVERDUE"
    FAULT = "FAULT"
