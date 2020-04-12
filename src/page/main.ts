/**
 * Contains code to build UI. Interacts with DOM.
 * @author       Tiger Oakes <tigeroakes@gmail.com>
 * @copyright    2014 Tiger Oakes
 */

import { GTFSData, Route, Stop, Trip } from '../gtfs-types.js';
import {
  clickEvent,
  createElement,
  documentLoad,
  dynamicLinkNode,
  getScheduleData,
  normal,
  placeShape,
  sequence,
  stopShape,
  unimportant,
  updateEvent,
  userShape,
} from './load.js';
import { createLocationMarker } from './location/marker.js';
import { hydrateAside } from './sidebar.js';
import { closestToSearch, closestToUser, stopToDisplay } from './state/map.js';
import { connect, LatLngLiteral, memoize, store, View } from './state/store.js';
import {
  gtfsArrivalToDate,
  gtfsArrivalToString,
  nowDateTime,
  stringTime,
} from './utils/date.js';
import { Linkable, parseLink, Type } from './utils/link.js';
import { toInt } from './utils/num.js';

let map: google.maps.Map | undefined;
let streetview: google.maps.StreetViewPanorama | undefined;
let autocomplete: google.maps.places.Autocomplete | undefined;
let boundsAllStops: google.maps.LatLngBounds | undefined;
let markers: StopMarker[] = [];
let stopMarker: google.maps.Marker | undefined;

const documentPromise = documentLoad();
const schedulePromise = getScheduleData();
const mapPromise = loadMap();

/*
schedulePromise.then(api => {
  window.api = api;
  window.store = store;
});
*/

export type LinkableMarker = google.maps.Marker & Linkable;
interface StopMarker extends LinkableMarker {
  stop_id: string;
  activeInRoute?: boolean;
}

// Update map when location changes
Promise.all([schedulePromise, mapPromise]).then(([schedule, map]) => {
  interface Props {
    stop?: Stop;
    location?: LatLngLiteral;
    buildMarker: ReturnType<typeof createLocationMarker>;
  }

  function updateMarker({ location, stop, buildMarker }: Props) {
    if (location) buildMarker(map, location, stop?.stop_id);
  }

  const buildUserMarker = createLocationMarker({
    title: 'My Location',
    icon: userShape,
    animation: google.maps.Animation.DROP,
    zIndex: 1000,
  });
  const buildPlaceMarker = createLocationMarker({
    title: 'Search Location',
    icon: placeShape,
    animation: google.maps.Animation.DROP,
    zIndex: 1000,
  });

  connect(
    store,
    state => ({
      location: state.userLocation,
      stop: closestToUser(schedule.stops, state),
      buildMarker: buildUserMarker,
    }),
    updateMarker,
  );
  connect(
    store,
    state => ({
      location: state.searchLocation,
      stop: closestToSearch(schedule.stops, state),
      buildMarker: buildPlaceMarker,
    }),
    updateMarker,
  );
});

// Create sidebar, and update it when nearby routes changes
Promise.all([
  schedulePromise,
  documentPromise.then(hydrateAside),
]).then(([schedule, connectStore]) => connectStore(schedule, store));

function stopToPos(stop: Stop) {
  return new google.maps.LatLng(
    parseFloat(stop.stop_lat),
    parseFloat(stop.stop_lon),
  );
}

function loadMap() {
  if (
    !navigator.onLine ||
    typeof google !== 'object' ||
    typeof google.maps !== 'object'
  ) {
    documentPromise.then(function() {
      document.body.classList.add('no-map');
    });
    throw new Error('Google Maps API has not loaded');
  }
  boundsAllStops = new google.maps.LatLngBounds();
  markers = [];

  function markersAndLatLng(schedule: GTFSData) {
    return Promise.resolve().then(() => {
      for (const stop of Object.values(schedule.stops)) {
        const marker = new google.maps.Marker({
          position: stopToPos(stop),
          title: stop.stop_name,
          icon: normal,
        }) as StopMarker;
        marker.Type = Type.STOP;
        marker.Value = stop.stop_id;
        marker.stop_id = stop.stop_id;
        google.maps.event.addListener(marker, 'click', clickEvent);
        boundsAllStops!.extend(marker.getPosition()!);
        markers.push(marker);
      }
      return {
        markers: markers,
        bounds: boundsAllStops!,
      };
    });
  }

  function mapLoad() {
    return Promise.resolve().then(() => {
      const stopView = store.getState().view.stop;
      const mapElement =
        stopView === View.MAP_PRIMARY
          ? document.getElementById('map-canvas')!
          : document.getElementById('streetview-canvas')!;
      const panoElement =
        stopView === View.STREET_PRIMARY
          ? document.getElementById('map-canvas')!
          : document.getElementById('streetview-canvas')!;

      map = new google.maps.Map(mapElement, {
        center: new google.maps.LatLng(19.6, -155.56),
        zoom: 10,
        mapTypeControlOptions: {
          position: google.maps.ControlPosition.TOP_CENTER,
        },
        panControlOptions: {
          position: google.maps.ControlPosition.RIGHT_TOP,
        },
        streetViewControlOptions: {
          position: google.maps.ControlPosition.RIGHT_TOP,
        },
        zoomControlOptions: {
          position: google.maps.ControlPosition.RIGHT_TOP,
        },
      });

      streetview = new google.maps.StreetViewPanorama(panoElement, {
        position: new google.maps.LatLng(19.723835, -155.084741),
        visible: true,
        pov: { heading: 34, pitch: 0 },
        scrollwheel: false,
        panControlOptions: {
          position: google.maps.ControlPosition.RIGHT_CENTER,
        },
        zoomControlOptions: {
          style: google.maps.ZoomControlStyle.SMALL,
          position: google.maps.ControlPosition.RIGHT_CENTER,
        },
        addressControl: false,
      });
      map.setStreetView(streetview!);

      autocomplete = new google.maps.places.Autocomplete(
        document.getElementById('search') as HTMLInputElement,
      );
      autocomplete.bindTo('bounds', map);
      google.maps.event.addListener(autocomplete, 'place_changed', function() {
        const place = autocomplete!.getPlace();
        if (!place.geometry) return;
        store.setState({
          searchLocation: place.geometry.location.toJSON(),
          focus: 'search',
        });
      });
      return map;
    });
  }

  const mapReady = documentPromise.then(mapLoad);

  Promise.all([mapReady, schedulePromise.then(markersAndLatLng)]).then(
    function([map, { markers, bounds }]) {
      map.setCenter(bounds.getCenter());
      map.fitBounds(bounds);
      google.maps.event.addListener(map, 'bounds_changed', function() {
        const mapBounds = map.getBounds()!;
        for (const marker of markers) {
          if (mapBounds.contains(marker.getPosition()!)) {
            if (marker.getMap() !== map) marker.setMap(map);
          } else {
            marker.setMap(null);
          }
        }
      });
      markers.forEach(marker => marker.setMap(map));
    },
  );

  window.addEventListener('resize', function() {
    google.maps.event.trigger(map, 'resize');
    google.maps.event.trigger(streetview, 'resize');
    if (!store.getState().route.id) {
      map!.setCenter(boundsAllStops!.getCenter());
      map!.fitBounds(boundsAllStops!);
    }
  });

  return mapReady;
}

documentPromise.then(function() {
  uiEvents();
});

schedulePromise.then(schedule => {
  function openActive(props: {
    route_id?: string;
    trip_id?: string;
    stop_id?: string;
  }) {
    let routePromise = Promise.resolve();
    if (props.route_id) {
      routePromise = openRoute(schedule, props.route_id).then(bestTrip =>
        openTrip(schedule, props.route_id, props.trip_id ?? bestTrip!),
      );
    }

    if (props.stop_id) openStop(schedule, props.route_id, props.stop_id);

    return routePromise;
  }

  connect(
    store,
    state => ({
      route_id: state.route.id || undefined,
      trip_id: state.route.trip || undefined,
      stop_id: stopToDisplay(schedule.stops, state),
    }),
    openActive,
  );
});

if (window.history.state) {
  store.setState(window.history.state);
} else {
  const state = parseLink(new URL(location.href));
  store.setState(state);
}
window.onhashchange = () => {
  const state = parseLink(new URL(location.href));
  store.setState(state);
};
window.onpopstate = (evt: PopStateEvent) => {
  store.setState(evt.state);
};

/**
 * Adds click events to buttons in the site.
 */
function uiEvents() {
  if (!navigator.onLine) {
    document.getElementById('main')!.classList.add('offline');
  }
  document
    .getElementById('map-toggle')!
    .addEventListener('click', switchMapStreetview);
  const select = document.getElementById('trip-select') as HTMLSelectElement &
    Linkable;
  select.Type = Type.TRIP;
  select.addEventListener('change', function(e) {
    select.Value = select.options[select.selectedIndex].value;
    clickEvent.call(select, e);
  });

  function toggleSidebar() {
    document.getElementById('aside')!.classList.toggle('open');
  }
  document
    .getElementById('screen-cover')!
    .addEventListener('click', toggleSidebar);
  document.getElementById('menu')!.addEventListener('click', toggleSidebar);
  document.getElementById('alt-menu')!.addEventListener('click', toggleSidebar);
}

function removeChildren(parent: HTMLElement) {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
}

/**
 * Swaps map and streetview divs
 * @return {[type]} [description]
 */
function switchMapStreetview(this: HTMLElement) {
  if (!map || !streetview) {
    console.error('Map and StreetViewPanorama have not loaded');
    throw new TypeError();
  }

  const mapParent = document.getElementById('map')!;
  const panoParent = document.getElementById('streetview-header')!;

  const view = { ...store.getState().view };

  if (view.stop === View.MAP_PRIMARY) {
    mapParent.insertBefore(
      document.getElementById('streetview-canvas')!,
      mapParent.firstChild,
    );
    panoParent.insertBefore(
      document.getElementById('map-canvas')!,
      mapParent.firstChild,
    );
    this.classList.add('on');
    view.stop = View.STREET_PRIMARY;
  } else if (view.stop === View.STREET_PRIMARY) {
    mapParent.insertBefore(
      document.getElementById('map-canvas')!,
      mapParent.firstChild,
    );
    panoParent.insertBefore(
      document.getElementById('streetview-canvas')!,
      mapParent.firstChild,
    );
    this.classList.remove('on');
    view.stop = View.MAP_PRIMARY;
  }
  store.setState({ view });
  dispatchEvent(updateEvent);
}

/**
 * Creates a route UI and opens the section if the map is currently in fullscreen mode.
 * @param  {string} route_id ID of the route
 * @return {Promise<string>} trip_id that can be used in openTrip. Best matches time and open stop, if any.
 */
const openRoute = memoize(function openRoute(
  buses: GTFSData,
  route_id: Route['route_id'],
): Promise<string | undefined> {
  const thisRoute = buses.routes[route_id];
  if (!thisRoute || !thisRoute.route_id) {
    console.error('Invalid Route %s', route_id);
    return Promise.resolve(undefined);
  }

  document.title = `${thisRoute.route_long_name} | Big Island Buses`;

  const container = document.getElementById('content')!;
  container.style.setProperty('--route-color', `#${thisRoute.route_color}`);
  container.style.setProperty(
    '--route-text-color',
    `#${thisRoute.route_text_color}`,
  );

  const name = document.getElementById('route_long_name')!;
  name.textContent = thisRoute.route_long_name;

  let firstStop: Stop['stop_id'] | undefined;
  let lastStop: Stop['stop_id'] | undefined;
  let largest = 0;
  let earliest = new Date(0, 0, 0, 23, 59, 59, 0);
  let latest = new Date(0, 0, 0, 0, 0, 0, 0);
  let earliestTrip: Trip['trip_id'] | undefined;
  let earliestTripStop: Stop['stop_id'] | undefined;

  const nowTime = nowDateTime();
  let closestTrip: Trip['trip_id'] | undefined;
  let closestTripTime = Number.MAX_VALUE;
  let closestTripStop: Stop['stop_id'] | undefined;
  const select = document.getElementById('trip-select')!;
  removeChildren(select);

  const routeStops = new Set<Stop['stop_id']>();

  for (const trip_id of Object.keys(thisRoute.trips)) {
    const trip = thisRoute.trips[trip_id];
    for (const stop in trip.stop_times) {
      if (stop == '1' && toInt(trip.direction_id) === 0) {
        firstStop = trip.stop_times[stop].stop_id;
      } else {
        if (toInt(stop) > largest && toInt(trip.direction_id) === 0) {
          largest = toInt(stop);
          lastStop = trip.stop_times[stop].stop_id;
        }
      }

      routeStops.add(trip.stop_times[stop].stop_id);

      const timeDate = gtfsArrivalToDate(trip.stop_times[stop].arrival_time);
      if (timeDate > latest) {
        latest = timeDate;
      }
      if (timeDate < earliest) {
        earliest = timeDate;
        earliestTrip = trip.trip_id;
        earliestTripStop = trip.stop_times[stop].stop_id;
      }

      if (
        timeDate.getTime() - nowTime.getTime() < closestTripTime &&
        timeDate.getTime() - nowTime.getTime() > 0
      ) {
        closestTripTime = timeDate.getTime() - nowTime.getTime();
        closestTrip = trip.trip_id;
        closestTripStop = trip.stop_times[stop].stop_id;
      }
    }
    if (!closestTrip) {
      //Too late for all bus routes
      closestTripTime =
        new Date(
          0,
          0,
          1,
          earliest.getHours(),
          earliest.getMinutes(),
          earliest.getSeconds(),
          0,
        ).getTime() - nowTime.getTime();
      closestTrip = earliestTrip;
      closestTripStop = earliestTripStop;
    }
    const option = createElement('option', {
      value: trip.trip_id,
      textContent: trip.trip_short_name,
    });
    select.appendChild(option);
  }

  const minString =
    Math.floor(closestTripTime / 60000) != 1
      ? Math.floor(closestTripTime / 60000) + ' minutes'
      : '1 minute';
  document.getElementById('place-value')!.textContent =
    'Between ' +
    buses!.stops[firstStop!].stop_name +
    ' - ' +
    buses!.stops[lastStop!].stop_name;
  document.getElementById('time-value')!.textContent =
    stringTime(earliest) + ' - ' + stringTime(latest);
  document.getElementById('next-stop-value')!.textContent =
    'Reaches ' + buses!.stops[closestTripStop!].stop_name + ' in ' + minString;

  document.getElementById('main')!.classList.add('open');

  if (
    navigator.onLine &&
    typeof google === 'object' &&
    typeof google.maps === 'object'
  ) {
    const routeBounds = new google.maps.LatLngBounds();
    for (const marker of markers) {
      if (routeStops.has(marker.stop_id)) {
        marker.setIcon(normal);
        marker.setZIndex(200);
        marker.activeInRoute = true;
        routeBounds.extend(marker.getPosition()!);
      } else {
        marker.setIcon(unimportant);
        marker.setZIndex(null);
        marker.activeInRoute = false;
      }
    }
    if (stopMarker) {
      stopMarker.setIcon(stopShape);
      stopMarker.setZIndex(300);
    }

    google.maps.event.trigger(map, 'resize');
    map!.setCenter(routeBounds.getCenter());
    map!.fitBounds(routeBounds);
    google.maps.event.trigger(streetview, 'resize');
  }

  window.dispatchEvent(updateEvent);
  return Promise.resolve(closestTrip);
});

/**
 * Creates a Stop fragment in the #stop element
 * @param  {[type]} stop_id Id of the stop to use
 * @return {void}           Creates an element
 */
function openStop(
  buses: GTFSData,
  currentRoute: Route['route_id'] | null | undefined,
  stop_id: Stop['stop_id'],
) {
  const thisStop = buses.stops[stop_id];
  if (!thisStop || !thisStop.stop_id) {
    console.error('Invalid Stop %s', stop_id);
    return;
  }

  if (streetview) {
    streetview.setPosition(stopToPos(thisStop));
  }
  if (map) {
    for (const marker of markers) {
      if (marker.activeInRoute || currentRoute == null) {
        marker.setIcon(normal);
      } else {
        marker.setIcon(unimportant);
      }
      if (marker.stop_id === thisStop.stop_id) {
        stopMarker = marker;
      }
    }

    stopMarker!.setIcon(stopShape);
    stopMarker!.setZIndex(300);

    streetview!.setPosition(stopMarker!.getPosition()!);
    google.maps.event.trigger(streetview, 'resize');
    google.maps.event.addListener(streetview!, 'pano_changed', function() {
      document.getElementById(
        'address',
      )!.textContent = streetview!.getLocation().description!;
      streetview!.setPov(streetview!.getPhotographerPov());
    });
  }
  if (!streetview) {
    document.getElementById('stop')!.classList.add('no-streetview');
  }

  document.getElementById('stop_name')!.textContent = thisStop.stop_name;

  const list = document.getElementById('connections')!;
  removeChildren(list);
  for (const route_id of thisStop.routes) {
    const route = buses.routes[route_id];
    const linkItem = dynamicLinkNode(Type.ROUTE, route_id, false);
    linkItem.className = 'connections__link';
    linkItem.style.borderColor = `#${route.route_color}`;
    linkItem.textContent = route.route_long_name;

    const listItem = document.createElement('li');
    listItem.className = 'connections__item';
    listItem.append(linkItem);
    if (currentRoute === route_id) {
      listItem.classList.add('connections__item--active-route');
    }
    list.append(listItem);
  }

  document.getElementById('main')!.classList.add('open-stop');
  window.dispatchEvent(updateEvent);
}

function openTrip(
  buses: GTFSData,
  route_id: Route['route_id'] | null | undefined,
  trip_id: Trip['trip_id'],
) {
  const route = buses.routes[route_id!];
  if (!route) {
    console.error('Invalid Route %s', route_id);
    return;
  }
  const trip = route.trips[trip_id];
  if (!trip || !trip.trip_id) {
    console.error('Invalid trip %s in route %s', trip_id, route_id);
    return;
  }

  const schedule = document.getElementById('schedule')!;
  removeChildren(schedule);

  const stopSequence = sequence(trip.stop_times);

  const select = document.getElementById('trip-select') as HTMLSelectElement;
  for (let option = 0; option < select.options.length; option++) {
    if (select.options[option].value === trip_id) {
      select.selectedIndex = option;
      select.options[option].selected = true;
      break;
    }
  }

  document.getElementById('week-days-value')!.textContent =
    buses.calendar[trip.service_id].text_name;

  for (const sequence of stopSequence) {
    const tripStop = trip.stop_times[sequence];
    const routeListItem = dynamicLinkNode(Type.STOP, tripStop.stop_id);
    routeListItem.className = 'schedule__stop';

    const lines = createElement('div', { className: 'lines' });
    for (let j = 0; j < 2; j++) {
      const line = createElement('span', { className: 'line' });
      lines.appendChild(line);
    }
    routeListItem.appendChild(lines);

    const name = createElement('span', {
      className: 'schedule__stopname name',
      textContent: buses.stops[tripStop.stop_id].stop_name,
    });
    routeListItem.appendChild(name);

    const time = createElement('time', {
      className: 'schedule__time',
      textContent: gtfsArrivalToString(tripStop.arrival_time),
    });
    routeListItem.appendChild(time);

    schedule.appendChild(routeListItem);
  }

  window.dispatchEvent(updateEvent);
}
