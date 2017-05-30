import * as React from 'react';
import * as moment from 'moment';
import { Trip } from 'gtfs-to-pouch/es/interfaces';
import RouteHeader from './RouteHeader';
import RouteInfoBox from './RouteInfoBox';
import Tabs from './Tabs';
import ScheduleList from './ScheduleList';

interface BasicRouteProps {
  now?: moment.Moment;
  disableMap?: boolean;
  route_id: string;
  route_long_name: string;
  route_short_name: string;
  route_text_color?: string;
  route_color?: string;
  route_days?: Set<number>;
  currentTrip?: Trip;
  changeTrip(newTrip: string | Trip): void;
}

interface BasicRouteState {
  infoPressed: boolean;
  selectedTab: 'schedule' | 'map';
}

const routeTabs = { schedule: 'Schedule', map: 'Map' };

export default class BasicRoute extends React.Component<BasicRouteProps, BasicRouteState> {
  constructor(props: BasicRouteProps) {
    super(props);
    this.state = { infoPressed: false, selectedTab: 'schedule' };
    this.handleInfoPress = this.handleInfoPress.bind(this);
  }

  handleInfoPress() {
    this.setState(state => ({ infoPressed: !state.infoPressed }));
  }

  handleTabChange(newSelected: 'schedule' | 'map') {
    this.setState({ selectedTab: newSelected });
  }

  render() {
    return (
      <article className="route">
        <header className="route-header">
          <RouteHeader
            route_long_name={this.props.route_long_name}
            route_short_name={this.props.route_short_name}
            route_text_color={this.props.route_text_color}
            route_color={this.props.route_color}
            infoPressed={this.state.infoPressed}
            onInfoPress={this.handleInfoPress}
          />
          <RouteInfoBox
            route_id={this.props.route_id}
            now={this.props.now}
          />
          <Tabs
            tabs={routeTabs}
            selected={this.state.selectedTab}
            onChange={this.handleTabChange}
            disabled={this.props.disableMap ? ['map'] : undefined}
          />
        </header>
        {(this.props.currentTrip && this.props.route_days) ? <ScheduleList
          route_id={this.props.route_id}
          route_days={this.props.route_days}
          trip={this.props.currentTrip}
          changeTrip={this.props.changeTrip}
        /> : null}
      </article>
    );
  }
}
