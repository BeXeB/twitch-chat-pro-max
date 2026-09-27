$Delay = 2

function Send-TwitchEvent {
    param (
        [string]$Event
    )

    Write-Host "→ $Event"

    twitch event trigger $Event --transport=websocket

    Start-Sleep -Seconds $Delay
}

function Send-Redemption {
    param (
        [string]$RewardName,
        [int]$Cost = 100
    )

    Write-Host "→ redemption: $RewardName"

    twitch event trigger channel.channel_points_custom_reward_redemption.add `
        --transport=websocket `
        --item-name="$RewardName" `
        --cost=$Cost

    Start-Sleep -Seconds $Delay
}

function Send-Resub {
    param (
        [string]$Message,
        [string]$Tier = "1000"
    )

    Write-Host "→ resub: [$Tier] $Message"

    twitch event trigger channel.subscription.message `
        --transport=websocket `
        --tier=$Tier

    Start-Sleep -Seconds $Delay
}

Write-Host "Starting Twitch mock event loop..."
Write-Host "Press Ctrl+C to stop."
Write-Host ""

while ($true) {

    # Stream starts
    Send-TwitchEvent "streamup"

    # Follows
    Send-TwitchEvent "follow"
    Send-TwitchEvent "follow"
    Send-TwitchEvent "follow"

    Send-TwitchEvent "channel.subscribe"

    Send-Resub "Still loving the stream!"
    Send-Resub "Another month! Keep it up!" "2000"
    Send-Resub "One whole year!" "3000"

    Send-TwitchEvent "channel.subscription.gift"

    # Bits
    Send-TwitchEvent "cheer"

    # Raid
    Send-TwitchEvent "raid"

    # Channel Point Redemptions
    Send-Redemption "Hydrate!" 100
    Send-Redemption "Posture Check" 500
    Send-Redemption "Bonk the Streamer" 1000
    Send-Redemption "Choose the Next Game" 2500

    # Hype Train
    Send-TwitchEvent "hype-train-begin"
    Send-TwitchEvent "hype-train-progress"
    Send-TwitchEvent "hype-train-end"

    # Poll
    Send-TwitchEvent "poll-begin"
    Send-TwitchEvent "poll-progress"
    Send-TwitchEvent "poll-end"

    # Prediction
    Send-TwitchEvent "prediction-begin"
    Send-TwitchEvent "prediction-progress"
    Send-TwitchEvent "prediction-lock"
    Send-TwitchEvent "prediction-end"

    # Stream ends
    Send-TwitchEvent "streamdown"

    Write-Host ""
    Write-Host "Cycle complete. Restarting..."
    Write-Host ""

    Start-Sleep -Seconds 5
}
