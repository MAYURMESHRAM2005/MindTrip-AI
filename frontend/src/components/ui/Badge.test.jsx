import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge, { DataStatusBadge } from './Badge';

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>Hello</Badge>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});

describe('DataStatusBadge', () => {
  it('labels live data', () => {
    render(<DataStatusBadge status="live" />);
    expect(screen.getByText(/live data/i)).toBeInTheDocument();
  });
  it('labels estimates', () => {
    render(<DataStatusBadge status="estimate" />);
    expect(screen.getByText(/estimate/i)).toBeInTheDocument();
  });
  it('labels unavailable data honestly', () => {
    render(<DataStatusBadge status="unavailable" />);
    expect(screen.getByText(/live data unavailable/i)).toBeInTheDocument();
  });
});
