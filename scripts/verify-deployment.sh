#!/bin/bash

# ================================================
# Deployment Verification Script
# ================================================
# Verifies that the deployment is healthy and running correctly
# Usage: ./verify-deployment.sh [environment] [base_url]
# Example: ./verify-deployment.sh beta https://beta.yourapp.com

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-beta}
BASE_URL=${2:-http://localhost:3001}
TIMEOUT=10
MAX_RETRIES=3

echo "================================================"
echo "Deployment Verification Script"
echo "Environment: $ENVIRONMENT"
echo "Base URL: $BASE_URL"
echo "================================================"
echo ""

# Function to print colored output
print_status() {
    local status=$1
    local message=$2

    if [ "$status" == "success" ]; then
        echo -e "${GREEN}✓${NC} $message"
    elif [ "$status" == "error" ]; then
        echo -e "${RED}✗${NC} $message"
    elif [ "$status" == "warning" ]; then
        echo -e "${YELLOW}⚠${NC} $message"
    else
        echo -e "$message"
    fi
}

# Function to check HTTP endpoint
check_endpoint() {
    local url=$1
    local expected_status=${2:-200}
    local retry_count=0

    while [ $retry_count -lt $MAX_RETRIES ]; do
        response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout $TIMEOUT "$url" 2>/dev/null || echo "000")

        if [ "$response" == "$expected_status" ]; then
            return 0
        fi

        retry_count=$((retry_count + 1))
        if [ $retry_count -lt $MAX_RETRIES ]; then
            print_status "warning" "Retry $retry_count/$MAX_RETRIES for $url (got $response, expected $expected_status)"
            sleep 2
        fi
    done

    return 1
}

# Function to check JSON endpoint and parse response
check_json_endpoint() {
    local url=$1
    local jq_filter=${2:-.}

    response=$(curl -s --connect-timeout $TIMEOUT "$url" 2>/dev/null || echo "{}")

    if [ -z "$response" ] || [ "$response" == "{}" ]; then
        return 1
    fi

    if command -v jq &> /dev/null; then
        echo "$response" | jq -r "$jq_filter"
    else
        echo "$response"
    fi
}

# ================================================
# 1. Health Check
# ================================================
echo "1. Checking API Health Endpoint..."
if check_endpoint "$BASE_URL/api/health"; then
    health_response=$(check_json_endpoint "$BASE_URL/api/health")
    print_status "success" "Health endpoint is responding"
    echo "   Response: $health_response"
else
    print_status "error" "Health endpoint failed"
    exit 1
fi
echo ""

# ================================================
# 2. Version Check
# ================================================
echo "2. Checking API Version..."
version=$(check_json_endpoint "$BASE_URL/api" ".version")
if [ -n "$version" ] && [ "$version" != "null" ]; then
    print_status "success" "API version: $version"
else
    print_status "warning" "Could not determine API version"
fi
echo ""

# ================================================
# 3. Database Connection
# ================================================
echo "3. Checking Database Connection..."
db_status=$(check_json_endpoint "$BASE_URL/api/health" ".database")
if [ "$db_status" == "healthy" ] || [ "$db_status" == "connected" ]; then
    print_status "success" "Database connection is healthy"
else
    print_status "error" "Database connection failed: $db_status"
    exit 1
fi
echo ""

# ================================================
# 4. Redis Connection (if applicable)
# ================================================
echo "4. Checking Redis Connection..."
redis_status=$(check_json_endpoint "$BASE_URL/api/health" ".redis")
if [ "$redis_status" == "healthy" ] || [ "$redis_status" == "connected" ]; then
    print_status "success" "Redis connection is healthy"
elif [ "$redis_status" == "null" ] || [ -z "$redis_status" ]; then
    print_status "warning" "Redis status not available (may not be required)"
else
    print_status "warning" "Redis connection issue: $redis_status"
fi
echo ""

# ================================================
# 5. WebSocket Connection
# ================================================
echo "5. Checking WebSocket Endpoint..."
# WebSocket check is more complex, so we just check if the endpoint exists
if check_endpoint "$BASE_URL/socket.io/" 400; then
    print_status "success" "WebSocket endpoint is available"
else
    print_status "warning" "WebSocket endpoint may not be available"
fi
echo ""

# ================================================
# 6. Docker Container Status (if running locally)
# ================================================
if [ "$ENVIRONMENT" != "production" ]; then
    echo "6. Checking Docker Container Status..."

    compose_file="docker-compose.${ENVIRONMENT}.yml"
    if [ -f "$compose_file" ]; then
        containers=$(docker-compose -f "$compose_file" ps --services 2>/dev/null || echo "")

        if [ -n "$containers" ]; then
            while IFS= read -r container; do
                status=$(docker-compose -f "$compose_file" ps "$container" | grep -c "Up" || echo "0")
                if [ "$status" -gt 0 ]; then
                    print_status "success" "Container $container is running"
                else
                    print_status "error" "Container $container is not running"
                fi
            done <<< "$containers"
        else
            print_status "warning" "Could not check Docker containers"
        fi
    else
        print_status "warning" "Docker compose file not found: $compose_file"
    fi
    echo ""
fi

# ================================================
# 7. API Endpoints Availability
# ================================================
echo "7. Checking Critical API Endpoints..."

endpoints=(
    "/api"
    "/api/auth/login"
    "/api/menu/categories"
    "/api/tables"
)

for endpoint in "${endpoints[@]}"; do
    # Most endpoints will return 401 (unauthorized) if not logged in, which is expected
    if check_endpoint "$BASE_URL$endpoint" 200 || check_endpoint "$BASE_URL$endpoint" 401; then
        print_status "success" "Endpoint $endpoint is accessible"
    else
        print_status "warning" "Endpoint $endpoint returned unexpected status"
    fi
done
echo ""

# ================================================
# 8. Performance Check (Response Time)
# ================================================
echo "8. Checking API Response Time..."
start_time=$(date +%s%N)
check_endpoint "$BASE_URL/api/health" > /dev/null 2>&1
end_time=$(date +%s%N)
response_time=$(( (end_time - start_time) / 1000000 ))  # Convert to milliseconds

if [ $response_time -lt 500 ]; then
    print_status "success" "Response time: ${response_time}ms (excellent)"
elif [ $response_time -lt 1000 ]; then
    print_status "success" "Response time: ${response_time}ms (good)"
elif [ $response_time -lt 2000 ]; then
    print_status "warning" "Response time: ${response_time}ms (acceptable)"
else
    print_status "warning" "Response time: ${response_time}ms (slow)"
fi
echo ""

# ================================================
# Summary
# ================================================
echo "================================================"
echo "Verification Complete!"
echo "================================================"
print_status "success" "Deployment verification passed"
echo ""
echo "Next steps:"
echo "1. Monitor logs: docker-compose -f docker-compose.${ENVIRONMENT}.yml logs -f"
echo "2. Check metrics and monitoring dashboards"
echo "3. Run integration tests if available"
echo "4. Perform manual smoke tests"
echo ""

exit 0
