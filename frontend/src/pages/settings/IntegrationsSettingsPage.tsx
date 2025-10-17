import { useState } from 'react';
import { Plug, Plus, Trash2, Power, PowerOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';

const IntegrationsSettingsPage = () => {
  // Placeholder data - will be replaced with actual API calls
  const [integrations] = useState([
    {
      id: '1',
      name: 'Stripe Payment Gateway',
      integrationType: 'PAYMENT_GATEWAY',
      provider: 'stripe',
      isEnabled: true,
      isConfigured: true,
      lastSyncedAt: '2025-10-15T10:30:00Z',
    },
    {
      id: '2',
      name: 'iyzico Payment Gateway',
      integrationType: 'PAYMENT_GATEWAY',
      provider: 'iyzico',
      isEnabled: false,
      isConfigured: true,
      lastSyncedAt: null,
    },
  ]);

  const getIntegrationTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      PAYMENT_GATEWAY: 'Payment Gateway',
      POS_HARDWARE: 'POS Hardware',
      THIRD_PARTY_API: 'Third Party API',
      DELIVERY_APP: 'Delivery App',
      ACCOUNTING: 'Accounting',
      CRM: 'CRM',
      INVENTORY: 'Inventory',
    };
    return types[type] || type;
  };

  return (
    <div className="h-full p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
            <p className="text-gray-600 mt-1">
              Connect third-party services and manage API integrations
            </p>
          </div>
          <Button variant="primary">
            <Plus className="h-4 w-4 mr-2" />
            Add Integration
          </Button>
        </div>
      </div>

      {/* Integration Categories */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Plug className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Payment Gateways</h3>
                <p className="text-sm text-gray-600">Card processors & terminals</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-100 rounded-lg">
                <Plug className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">POS Hardware</h3>
                <p className="text-sm text-gray-600">Printers, cash drawers</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-100 rounded-lg">
                <Plug className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Delivery Apps</h3>
                <p className="text-sm text-gray-600">Food delivery platforms</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Configured Integrations */}
      <Card>
        <CardHeader>
          <CardTitle>Configured Integrations</CardTitle>
        </CardHeader>
        <CardContent>
          {integrations.length === 0 ? (
            <div className="text-center py-12">
              <Plug className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-4">No integrations configured yet</p>
              <Button variant="primary">
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Integration
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {integrations.map((integration) => (
                <div
                  key={integration.id}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div
                      className={`p-3 rounded-lg ${
                        integration.isEnabled ? 'bg-green-100' : 'bg-gray-100'
                      }`}
                    >
                      <Plug
                        className={`h-5 w-5 ${
                          integration.isEnabled ? 'text-green-600' : 'text-gray-400'
                        }`}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900">{integration.name}</h3>
                        {integration.isEnabled ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="default">Inactive</Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">
                        {getIntegrationTypeLabel(integration.integrationType)} •{' '}
                        {integration.provider}
                        {integration.lastSyncedAt &&
                          ` • Last synced: ${new Date(
                            integration.lastSyncedAt
                          ).toLocaleString()}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        /* Toggle integration status */
                      }}
                    >
                      {integration.isEnabled ? (
                        <>
                          <PowerOff className="h-4 w-4 mr-1" />
                          Disable
                        </>
                      ) : (
                        <>
                          <Power className="h-4 w-4 mr-1" />
                          Enable
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        /* Delete integration */
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* API & Webhooks Section */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>API Keys & Webhooks</CardTitle>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Generate API Key
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-600">
              API keys allow external applications to integrate with your system.
              Webhooks enable real-time notifications for events like new orders or
              inventory updates.
            </p>
            <Button variant="link" size="sm" className="mt-2">
              View API Documentation
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default IntegrationsSettingsPage;
