<?php

namespace App\Domain\Integrations;

enum SourceSystem: string
{
    case YTP = 'road_repair';
    case ROADVISION = 'roadvision';
}
