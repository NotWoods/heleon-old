import { Component, h } from 'preact';
import { Stop, Trip, Weekdays } from '../../server-render/api-types';
import { fromIsoTime, WEEKDAY_NAMES } from '../../server-render/parse-date';
import { TimeData, toTime } from '../Time';
import { NextStop } from './NextStop';
import { RouteLocation } from './RouteLocation';
import { RouteTime } from './RouteTime';
import { RouteWeekdays } from './RouteWeekdays';
import { ScheduleTimes } from './ScheduleTimes';
import { SelectTrip } from './SelectTrip';

interface ScheduleInfoProps {
    route_id: string;
    trip_id?: string | null;
    name: string;
    color: string;
    text_color: string;
    trips: Record<string, Pick<Trip, 'trip_id' | 'name' | 'stop_times'>>;
    first_stop: string;
    last_stop: string;
    start_time: string;
    end_time: string;
    days: Weekdays;
    stops: Record<string, Pick<Stop, 'stop_id' | 'name'>>;
    nowTime: TimeData;
}

function weekdaysToString(days: Weekdays) {
    if (days.every(Boolean)) return 'Daily';
    if (days[0] && days[6] && days.slice(1, 6).every(b => !b)) {
        return 'Saturday - Sunday';
    }
    const firstDay = days.indexOf(true);
    const lastDay = days.lastIndexOf(true);
    if (firstDay === lastDay) return WEEKDAY_NAMES[firstDay];
    else if (days.slice(firstDay, lastDay + 1).every(Boolean)) {
        return `${WEEKDAY_NAMES[firstDay]} - ${WEEKDAY_NAMES[lastDay]}`;
    } else {
        return WEEKDAY_NAMES.filter((_, i) => days[i]).join(', ');
    }
}

export class ScheduleInfo extends Component<ScheduleInfoProps> {
    render(props: ScheduleInfoProps) {
        const now = fromIsoTime(props.nowTime.iso);
        let closestTrip: string = '';
        let closestTripTime = Number.MAX_VALUE;
        let closestTripStop: string;
        let earliestTrip: string = '';
        let earliestTripTime = Number.MAX_VALUE;
        let earliestTripStop: string;
        for (const trip of Object.values(props.trips)) {
            for (const stop of trip.stop_times) {
                const time = fromIsoTime(stop.time).getTime();
                const duration = time - now.getTime();
                if (duration < closestTripTime && duration > 0) {
                    closestTripTime = duration;
                    closestTrip = trip.trip_id;
                    closestTripStop = stop.stop_id;
                }
                if (time < earliestTripTime) {
                    earliestTripTime = time;
                    earliestTrip = trip.trip_id;
                    earliestTripStop = stop.stop_id;
                }
            }
        }
        if (!closestTrip) {
            closestTripTime = earliestTripTime - now.getTime();
            closestTrip = earliestTrip;
            closestTripStop = earliestTripStop!;
        }
        const minutes = Math.floor(closestTripTime / 60000);
        const nextStopDuration: TimeData = {
            iso: `PT${minutes}M`,
            formatted: Intl.RelativeTimeFormat
                ? new Intl.RelativeTimeFormat().format(minutes, 'minute')
                : minutes === 1
                ? '1 minute'
                : `${minutes} minutes`,
        };

        const currentTrip = props.trip_id || closestTrip;
        return (
            <div id="schedule-column">
                <section id="information">
                    <SelectTrip
                        trips={Object.values(props.trips)}
                        trip_id={currentTrip}
                    />
                    <RouteLocation
                        firstStop={props.stops[props.first_stop]}
                        lastStop={props.stops[props.last_stop]}
                    />
                    <RouteTime
                        startTime={toTime(fromIsoTime(props.start_time))}
                        endTime={toTime(fromIsoTime(props.end_time))}
                    />
                    <RouteWeekdays weekdays={weekdaysToString(props.days)} />
                    <NextStop
                        nextStop={props.stops[closestTripStop!]}
                        timeToArrival={nextStopDuration}
                    />
                </section>
                <ScheduleTimes
                    stopTimes={props.trips[currentTrip].stop_times}
                    color={props.color}
                    stops={props.stops}
                />
            </div>
        );
    }
}
