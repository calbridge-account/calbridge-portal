import { Card, Title, Text } from '@tremor/react';
import { useDateRange } from '../context/DateRangeContext';

export default function Opportunities() {
  const { rangeLabel } = useDateRange();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Opportunities</h1>
        <p className="text-sm text-gray-500 mt-1">Showing data for: {rangeLabel()}</p>
      </div>
      <Card>
        <Title>Coming Soon</Title>
        <Text>This section is being built.</Text>
      </Card>
    </div>
  );
}
