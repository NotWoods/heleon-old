import { resolve, relative } from 'path';
import { outputJson, WriteOptions } from 'fs-extra';
import { promise as alasql } from 'alasql';
import { getAllTimezones, Timezone } from 'countries-and-timezones';
import {
    Omit,
    Route,
    Trip,
    StopTime,
    Stop,
    Calendar,
    RouteDetails,
    Weekdays,
} from './api-types';
import { toIsoTime, parseGtfsTime, WEEKDAY_NAMES } from './parse-date';

const GTFS_FOLDER = resolve(__dirname, '..', 'static', 'google_transit');
const API_FOLDER = resolve(__dirname, '..', 'public', 'api');

const jsonOpts: WriteOptions = { spaces: 2 };

interface CalendarData {
    sunday: number;
    monday: number;
    tuesday: number;
    wednesday: number;
    thursday: number;
    friday: number;
    saturday: number;
}

const WEEKDAY_PROP_NAMES = WEEKDAY_NAMES.map(d =>
    d.toLowerCase(),
) as (keyof CalendarData)[];

const NO_WEEKDAYS = [
    false,
    false,
    false,
    false,
    false,
    false,
    false,
] as Weekdays;

function csv(file: string) {
    const path = relative(process.cwd(), resolve(GTFS_FOLDER, `${file}.txt`));
    return `CSV('${path}', {separator:",", headers: true})`;
}

function toObject<T>(iter: Iterable<T>, key: keyof T) {
    const map: Record<string, T> = {};
    for (const el of iter) map[el[key] as any] = el;
    return map;
}

function toWeekdays(cal: CalendarData) {
    return WEEKDAY_PROP_NAMES.map(n => Boolean(cal[n])) as Weekdays;
}

async function makeTripApi(route: Omit<Route, 'trip_ids'>) {
    const { route_id } = route;
    const tripsRes: Omit<Trip, 'stop_times'>[] = await alasql(
        `SELECT route_id, service_id, trip_id, trip_headsign AS headsign, trip_short_name AS name, direction_id
        FROM ${csv('trips')}
        WHERE route_id='${route_id}'`,
    );

    const serviceIds = Array.from(new Set(tripsRes.map(t => t.service_id)));
    const calendarData: CalendarData[] = await alasql(
        `SELECT sunday, monday, tuesday, wednesday, thursday, friday, saturday
        FROM ${csv('calendar')}
        WHERE service_id IN (${serviceIds.join(', ')})`,
    );
    const weekdays = calendarData.reduce((arr, cal) => {
        const added = toWeekdays(cal);
        return arr.map((day, i) => day || added[i]) as Weekdays;
    }, NO_WEEKDAYS);

    const timezones = (getAllTimezones() as any) as Record<string, Timezone>;
    const timezone = timezones[route.timezone];

    let first_stop: string = '';
    let first_stop_sequence = Infinity;
    let last_stop: string = '';
    let last_stop_sequence = 0;
    let start_time = parseGtfsTime('23:59:59');
    let end_time = parseGtfsTime('00:00:00');
    const trips = await Promise.all(
        tripsRes.map(async trip => {
            const stop_times: Array<
                StopTime & { stop_sequence: number }
            > = await alasql(
                `SELECT arrival_time AS time, stop_id, stop_sequence
                FROM ${csv('stop_times')}
                WHERE trip_id='${trip.trip_id}'
                ORDER BY stop_sequence ASC`,
            );
            (trip as Trip).stop_times = stop_times.map(stopTime => {
                const time = parseGtfsTime(stopTime.time);
                if (trip.direction_id === 0) {
                    if (stopTime.stop_sequence < first_stop_sequence) {
                        first_stop = stopTime.stop_id;
                        first_stop_sequence = stopTime.stop_sequence;
                    }
                    if (stopTime.stop_sequence > last_stop_sequence) {
                        last_stop = stopTime.stop_id;
                        last_stop_sequence = stopTime.stop_sequence;
                    }
                }
                if (time > end_time) {
                    end_time = time;
                }
                if (time < start_time) {
                    start_time = time;
                }

                stopTime.time = toIsoTime(time) + timezone.offsetStr;
                delete stopTime.stop_sequence;
                return stopTime as StopTime;
            });
            return trip as Trip;
        }),
    );

    if (!first_stop || !last_stop) {
        throw new Error('Could not find first or last stop.');
    }

    const tripMap = toObject(trips, 'trip_id');
    const path = resolve(API_FOLDER, 'routes', `${route_id}.json`);
    const details: RouteDetails = {
        ...route,
        trips: tripMap,
        days: weekdays,
        first_stop,
        last_stop,
        start_time: toIsoTime(start_time) + timezone.offsetStr,
        end_time: toIsoTime(end_time) + timezone.offsetStr,
    };

    await outputJson(path, details, jsonOpts);

    return trips.map(trip => trip.trip_id);
}

async function makeRoutesApi() {
    const [routesRes, agencyRes] = await Promise.all([
        alasql(
            `SELECT route_id, route_long_name AS name, route_url AS source_url, route_color AS color, route_text_color AS text_color, route_sort_order AS sort_order, agency_id
            FROM ${csv('routes')}
            ORDER BY route_sort_order ASC`,
        ) as Promise<
            Array<Omit<Route, 'trip_ids' | 'timezone'> & { agency_id: string }>
        >,
        alasql(
            `SELECT agency_id, agency_timezone
            FROM ${csv('agency')}`,
        ) as Promise<Array<{ agency_id: string; agency_timezone: string }>>,
    ]);
    const agencies = toObject(agencyRes, 'agency_id');

    const routes = await Promise.all(
        routesRes.map(async rawRoute => {
            const agency = agencies[rawRoute.agency_id];
            delete rawRoute.agency_id;
            const route = rawRoute as Omit<Route, 'trip_ids'>;
            route.timezone = agency.agency_timezone;

            const trip_ids = await makeTripApi(route);
            (route as Route).trip_ids = trip_ids;
            return route as Route;
        }),
    );

    const path = resolve(API_FOLDER, 'routes.json');
    await outputJson(path, routes, jsonOpts);
}

async function makeStopsApi() {
    const res = await Promise.all([
        alasql(
            `SELECT stop_id, stop_name AS name, stop_lat AS lat, stop_lon AS lon
            FROM ${csv('stops')}`,
        ) as Promise<Omit<Stop, 'route_ids'>[]>,
        alasql(
            `SELECT trip_id, route_id
            FROM ${csv('trips')}`,
        ) as Promise<Pick<Trip, 'trip_id' | 'route_id'>[]>,
    ]);
    const stopsRes = res[0];
    const tripMap = toObject(res[1], 'trip_id');

    const stops = await Promise.all(
        stopsRes.map(async stop => {
            const tripIds: { trip_id: string }[] = await alasql(
                `SELECT DISTINCT trip_id
                FROM ${csv('stop_times')}
                WHERE stop_id='${stop.stop_id}'`,
            );
            (stop as Stop).route_ids = Array.from(
                new Set(tripIds.map(t => tripMap[t.trip_id].route_id)),
            );
            return stop as Stop;
        }),
    );

    const stopMap = toObject(stops, 'stop_id');
    const path = resolve(API_FOLDER, 'stops.json');
    await outputJson(path, stopMap, jsonOpts);
}

async function makeCalendarApi() {
    const calendarRes: Array<
        CalendarData & Pick<Calendar, 'service_id'>
    > = await alasql(
        `SELECT service_id, sunday, monday, tuesday, wednesday, thursday, friday, saturday
        FROM ${csv('calendar')}`,
    );

    function toIso({ date }: { date: string }) {
        return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
    }

    const calendar: Calendar[] = await Promise.all(
        calendarRes.map(async cal => {
            const days = toWeekdays(cal);

            let description: string;
            if (days.every(Boolean)) description = 'Daily';
            else if (!days[0] && days.slice(1).every(Boolean))
                description = 'Monday - Saturday';
            else if (!days[0] && !days[6] && days.slice(1, 6).every(Boolean))
                description = 'Monday - Friday';
            else if (days[0] && days[6] && days.slice(1, 6).every(b => !b))
                description = 'Saturday - Sunday';
            else {
                const firstDay = days.indexOf(true);
                const lastDay = days.lastIndexOf(true);
                if (firstDay === lastDay) description = WEEKDAY_NAMES[firstDay];
                else
                    description = `${WEEKDAY_NAMES[firstDay]} - ${
                        WEEKDAY_NAMES[lastDay]
                    }`;
            }

            const exceptionsRes: {
                date: string;
                exception_type: number;
            }[] = await alasql(
                `SELECT date, exception_type
                FROM ${csv('calendar_dates')}
                WHERE service_id='${cal.service_id}'`,
            );

            return {
                service_id: cal.service_id,
                days,
                description,
                exceptions: {
                    added: exceptionsRes
                        .filter(e => e.exception_type === 1)
                        .map(toIso),
                    removed: exceptionsRes
                        .filter(e => e.exception_type === 2)
                        .map(toIso),
                },
            };
        }),
    );

    const calendarMap = toObject(calendar, 'service_id');
    const path = resolve(API_FOLDER, 'calendar.json');
    await outputJson(path, calendarMap, jsonOpts);
}

export async function main() {
    await Promise.all([makeRoutesApi(), makeStopsApi(), makeCalendarApi()]);
}

if (require.main === module) {
    main().catch(console.error);
}
