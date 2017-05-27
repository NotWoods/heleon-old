import * as React from 'react';
import '../css/vars.css';
import '../css/Tabs.css';

interface TabProps {
  tabKey: string;
  selected: boolean;
  disabled?: string[];
  onChange(tabKey: string): void;
}

/** A single tab element */
const Tab: React.SFC<TabProps> = props => {
  let disabled = false;
  if (props.disabled) { disabled = props.disabled.indexOf(props.tabKey) > -1; }

  return (
    <button
      className={'tab' + (props.selected ? ' is-selected' : '')}
      onClick={props.selected ? undefined : () => props.onChange(props.tabKey)}
      disabled={disabled}
    >
      {props.children}
    </button>
  );
};

interface ControlledTabsProps {
  tabs: { [key: string]: React.ReactNode };
  selected: string;
  disabled?: string[];
  onChange(newSelected: string): void;
}

/** Tabs element without logic */
const SimpleTabs: React.SFC<ControlledTabsProps> = props => {
  const indicatorStyle: React.CSSProperties = {
    transform: `translateX(0)`
  };

  return (
    <div className="tabs-container">
      <nav className="tabs">
        {Object.keys(props.tabs).map((key, index) => {
          const isSelected = props.selected === key;
          if (isSelected) {
            indicatorStyle.transform = `translateX(${index * 100}%)`;
          }

          return (
            <Tab
              key={key}
              tabKey={key}
              selected={isSelected}
              onChange={props.onChange}
              disabled={props.disabled}
            >
              {props.tabs[key]}
            </Tab>
          );
        })}
        <div className="tab-indicator" style={indicatorStyle} />
      </nav>
    </div>
  );
};

interface UncontrolledTabsProps {
  tabs: { [key: string]: React.ReactNode };
  disabled?: string[];
}

type TabsProps = UncontrolledTabsProps | ControlledTabsProps;

interface TabsState {
  selected: string;
}

/**
 * A list of tabs to display for navigation. The `tabs` prop lists each tab to
 * use, as a object where the keys are tab keys and the values are the text to
 * display for the tab (can also be React elements).
 * The onChange function is called when another tab is selected
 */
export default class Tabs extends React.Component<TabsProps, TabsState> {
  constructor(props: TabsProps) {
    super(props);
    this.state = { selected: Object.keys(props.tabs)[0] };

    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(newTab: string) {
    const { onChange } = this.props as ControlledTabsProps;
    if (onChange) { onChange(newTab); }
    this.setState({ selected: newTab });
  }

  getSelected(): string {
    const { selected } = this.props as ControlledTabsProps;
    return selected || this.state.selected;
  }

  render() {
    return (
      <SimpleTabs
        tabs={this.props.tabs}
        disabled={this.props.disabled}
        onChange={this.handleChange}
        selected={this.getSelected()}
      />
    );
  }
}
