<?php

namespace App\Infrastructure\Outbox;

use App\Domain\Outbox\OutboxPublisher;
use Illuminate\Mail\Message;
use Illuminate\Support\Facades\Mail;

final class EmailPublisher implements OutboxPublisher
{
    public function supports(string $destination): bool
    {
        return strtolower($destination) === 'email';
    }

    public function publish(string $eventId, string $eventKind, array $payload): void
    {
        $to = trim((string) ($payload['to'] ?? ''));
        $subject = trim((string) ($payload['subject'] ?? ''));
        $body = trim((string) ($payload['body'] ?? ''));
        if (! filter_var($to, FILTER_VALIDATE_EMAIL) || $subject === '' || $body === '') {
            throw new \InvalidArgumentException('Email outbox payload is incomplete.');
        }
        if (str_contains($subject, "\r") || str_contains($subject, "\n")) {
            throw new \InvalidArgumentException('Email subject contains a line break.');
        }

        Mail::raw($body, static function (Message $message) use ($to, $subject): void {
            $message->to($to)->subject($subject);
        });
    }
}
