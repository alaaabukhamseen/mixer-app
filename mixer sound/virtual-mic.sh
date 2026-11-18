#!/usr/bin/env bash
# ==============================================================================
# AuraMixer PipeWire virtual microphone (Discord / games / apps)
#
# The browser plays the app's mix on a hidden media element and this script
# links that element's PipeWire output ports into SoundboardSink (a loopback),
# which exposes "Soundboard Virtual Mic" as a normal microphone to
# every other application.
# ==============================================================================
set -uo pipefail

PID_FILE="/tmp/soundboard_virtual_mic.pid"
SINK_NODE="SoundboardSink"
SOURCE_NODE="VirtualMic"

is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid
        pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    pgrep -f "pw-loopback.*node.name=${SINK_NODE}" >/dev/null 2>&1
}

wait_for_ports() {
    local tries=0
    while [ "$tries" -lt 40 ]; do
        if pw-link -i 2>/dev/null | grep -q "${SINK_NODE}:playback_FL" &&
           pw-link -o 2>/dev/null | grep -q "${SOURCE_NODE}:capture_FL"; then
            return 0
        fi
        tries=$((tries + 1))
        sleep 0.1
    done
    return 1
}

port_ids() {
    # $1 = input|output, $2 = node name, $3 = port suffix (e.g. playback_FL)
    local flag="-o"
    [ "$1" = "input" ] && flag="-i"
    pw-link "$flag" -I 2>/dev/null |
        awk -v target="${2}:${3}" '$2 == target { print $1 }'
}

browser_output_ids() {
    # Print "id name" for browser / media-element output ports. Node names vary
    # by browser ("Firefox", "Brave", "Google Chrome", "Playback Stream"), so
    # match known application names and any *:output_FL/FR or *:playback_FL/FR
    # port instead of one exact string.
    pw-link -o -I 2>/dev/null |
        awk '{
            name = tolower($2);
            if (name !~ /:(output|playback)_(fl|fr)$/) next;
            if (name ~ /^(brave|firefox|chrome|chromium|google[- ]chrome|microsoft[- ]edge|msedge|vivaldi|opera|playback stream|audio stream)/) print $1, $2;
        }'
}

# True when output port $1 is already linked to input port $2.
link_exists() {
    pw-cli ls Link 2>/dev/null | awk -v o="$1" -v i="$2" '
        /link.output.port/ { line = $0; gsub(/[^0-9]/, "", line); out = line }
        /link.input.port/ {
            line = $0; gsub(/[^0-9]/, "", line);
            if (out == o && line == i) found = 1;
        }
        END { exit(found ? 0 : 1) }'
}

# Remove duplicate links between the same output/input port pair. Older app
# versions linked on every call, and stacked links make the mic feed several
# times louder and distorted.
dedupe_links() {
    pw-cli ls Link 2>/dev/null | awk '
        /^[[:space:]]*id [0-9]+, type PipeWire:Interface:Link/ {
            id = $2; gsub(/[^0-9]/, "", id); out = ""; inp = ""
        }
        /link.output.port/ { out = $0; gsub(/[^0-9]/, "", out) }
        /link.input.port/ {
            inp = $0; gsub(/[^0-9]/, "", inp);
            if (out != "" && inp != "" && id != "") print out, inp, id
        }
    ' | awk '{ key = $1 ":" $2; if (seen[key]++) print $3 }' |
        while read -r link_id; do
            [ -n "$link_id" ] || continue
            pw-cli destroy "$link_id" >/dev/null 2>&1 || true
        done
}

# Connect every browser output stream to the loopback sink. Different tabs can
# expose several ports, so each port ID is linked individually instead of
# linking by the ambiguous display name.
link_browsers_to_virtual_mic() {
    if ! is_running; then
        echo "ERROR: Virtual microphone is not running."
        return 1
    fi

    dedupe_links

    local sink_fl sink_fr browser_count id name is_fr
    sink_fl=$(port_ids input "$SINK_NODE" "playback_FL" | head -1)
    sink_fr=$(port_ids input "$SINK_NODE" "playback_FR" | head -1)

    if [ -z "$sink_fl" ] && [ -z "$sink_fr" ]; then
        echo "ERROR: Soundboard sink ports were not found."
        return 1
    fi

    browser_count=$(browser_output_ids | wc -l)
    if [ "$browser_count" -eq 0 ]; then
        echo "ERROR: No browser audio output was found. Start playback in the browser first."
        return 1
    fi

    while read -r id name; do
        [ -n "$id" ] || continue
        is_fr=0
        case "$name" in
            *output_FR|*playback_FR) is_fr=1 ;;
        esac
        if [ "$is_fr" -eq 1 ] && [ -n "$sink_fr" ]; then
            link_exists "$id" "$sink_fr" || pw-link "$id" "$sink_fr" >/dev/null 2>&1 || true
        elif [ "$is_fr" -eq 0 ] && [ -n "$sink_fl" ]; then
            link_exists "$id" "$sink_fl" || pw-link "$id" "$sink_fl" >/dev/null 2>&1 || true
        fi
    done < <(browser_output_ids)

    echo "LINKED: Browser audio output is connected to ${SINK_NODE}."
    return 0
}

# True when at least one stream is linked into the loopback sink. Used after
# setSinkId: Chromium can report success while no PipeWire link is created
# (for example after the virtual sink was stopped and recreated).
check_sink_link() {
    if pw-link -l 2>/dev/null | awk '
        /^SoundboardSink:playback_(FL|FR)$/ { sink = 1; next }
        sink && /\|<-/ { found = 1 }
        sink && !/\|<-/ { sink = 0 }
        END { exit(found ? 0 : 1) }'; then
        echo "LINKED: Browser audio is connected to ${SINK_NODE}."
        return 0
    fi
    echo "NOT_LINKED: No browser audio is connected to ${SINK_NODE}."
    return 1
}

unlink_browsers_from_virtual_mic() {
    local sink_fl sink_fr id name is_fr
    sink_fl=$(port_ids input "$SINK_NODE" "playback_FL" | head -1)
    sink_fr=$(port_ids input "$SINK_NODE" "playback_FR" | head -1)

    while read -r id name; do
        [ -n "$id" ] || continue
        is_fr=0
        case "$name" in
            *output_FR|*playback_FR) is_fr=1 ;;
        esac
        if [ "$is_fr" -eq 1 ] && [ -n "$sink_fr" ]; then
            pw-link -d "$id" "$sink_fr" >/dev/null 2>&1 || true
        elif [ "$is_fr" -eq 0 ] && [ -n "$sink_fl" ]; then
            pw-link -d "$id" "$sink_fl" >/dev/null 2>&1 || true
        fi
    done < <(browser_output_ids)

    echo "UNLINKED: Browser audio capture is disconnected."
    return 0
}

start_virtual_mic() {
    if is_running; then
        echo "ALREADY_ACTIVE: Virtual microphone is already running."
        return 0
    fi

    if ! command -v pw-loopback &>/dev/null; then
        echo "ERROR: pw-loopback not found. Please install PipeWire tools."
        return 1
    fi

    # Remove a stale PID file from a previous crash.
    rm -f "$PID_FILE"

    echo "Starting AuraMixer virtual microphone via pw-loopback..."
    setsid pw-loopback \
        --capture-props="media.class=Audio/Sink node.name=${SINK_NODE} node.description=\"Soundboard & Voice Changer Sink\"" \
        --playback-props="media.class=Audio/Source node.name=${SOURCE_NODE} node.description=\"Soundboard Virtual Mic\"" \
        </dev/null >/dev/null 2>&1 &

    local pid=$!
    echo "$pid" > "$PID_FILE"

    if wait_for_ports; then
        echo "SUCCESS: Virtual microphone is running (PID: $pid)."
        echo "Sink: Soundboard & Voice Changer Sink"
        echo "Source: Soundboard Virtual Mic"
        return 0
    fi

    if kill -0 "$pid" 2>/dev/null; then
        echo "WARN: Loopback is running but its ports did not appear yet (PID: $pid)."
        return 0
    fi

    rm -f "$PID_FILE"
    echo "ERROR: Failed to start the virtual microphone."
    return 1
}

stop_virtual_mic() {
    local stopped=0 pid
    unlink_browsers_from_virtual_mic >/dev/null 2>&1 || true

    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null && stopped=1 || true
        fi
        rm -f "$PID_FILE"
    fi

    if pkill -f "pw-loopback.*node.name=${SINK_NODE}" >/dev/null 2>&1; then
        stopped=1
    fi

    if [ "$stopped" -eq 1 ]; then
        echo "STOPPED: Virtual microphone stopped."
    else
        echo "INACTIVE: Virtual microphone was not running."
    fi
    return 0
}

status_virtual_mic() {
    if is_running; then
        echo "ACTIVE"
        if command -v wpctl &>/dev/null; then
            local sink_name
            sink_name=$(wpctl inspect @DEFAULT_AUDIO_SINK@ 2>/dev/null |
                sed -n 's/.*node.name = "\(.*\)"/\1/p' | head -1)
            [ -n "$sink_name" ] && echo "Default output: $sink_name"
        fi
        return 0
    fi
    echo "INACTIVE"
    return 1
}

case "${1:-status}" in
    start)   start_virtual_mic ;;
    stop)    stop_virtual_mic ;;
    restart) stop_virtual_mic || true; sleep 0.5; start_virtual_mic ;;
    status)  status_virtual_mic ;;
    link)    link_browsers_to_virtual_mic ;;
    ensure)  link_browsers_to_virtual_mic ;;
    check)   check_sink_link ;;
    unlink)  unlink_browsers_from_virtual_mic ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|link|ensure|check|unlink}"
        exit 1
        ;;
esac
